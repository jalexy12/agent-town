import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

export interface Agent {
  id: string
  name: string
  area: 'forest' | 'hills' | 'riverbank' | 'ruins' | 'commons'
  status: 'idle' | 'busy' | 'sleeping'
  action: string
  turns: number
  gold: number
}

export interface GameState {
  agents: Agent[]
  day: number
  season: string
  timeOfDay: string
}

// Claude's content block types
export type ContentBlock =
  | { type: 'thinking'; thinking: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

// Claude's Message response
export interface Message {
  content: ContentBlock[]
}

export interface ActivityEvent {
  id: string
  time: string
  agent: string
  message: Message
}

interface SSEEvent {
  type: 'TURN' | 'TIME_UPDATE' | 'SEASON_CHANGE' | 'AGENT_UPDATE' | 'connected'
  agentId?: string
  message?: Message
  // TIME_UPDATE fields
  day?: number
  timeOfDay?: string
  season?: string
  // AGENT_UPDATE fields - agent state from DB
  agent?: {
    id: string
    name: string
    area: Agent['area']
    status: Agent['status']
    gold: number
    turns: string | number
    currentAction: string | null
  }
}

// Module-level singleton to survive React Strict Mode
let globalEventSource: EventSource | null = null
let connectionCount = 0

/**
 * SSE subscription hook - manages connection lifecycle.
 * Call once in root layout. Uses TkDodo-approved pattern:
 * SSE events update query cache via setQueryData.
 */
export function useGameEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    connectionCount++

    // Only create connection on first mount
    if (!globalEventSource) {
      console.log('[SSE] Connecting to control plane...')
      globalEventSource = new EventSource(`${import.meta.env.VITE_API_URL}/events`)

      globalEventSource.onopen = () => {
        console.log('[SSE] Connected')
      }

      globalEventSource.onerror = () => {
        if (globalEventSource?.readyState === EventSource.CLOSED) {
          console.log('[SSE] Connection closed, will reconnect')
          globalEventSource = null
        }
      }
    }

    // Set up message handler (always, since queryClient might change)
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SSEEvent

        // Helper to get agent name from ID
        const getAgentName = (agentId: string) => {
          const gameState = queryClient.getQueryData<GameState>(['game-state'])
          const agent = gameState?.agents.find((a) => a.id === agentId)
          return agent?.name || agentId
        }

        if (data.type === 'TURN' && data.agentId && data.message) {
          const agentName = getAgentName(data.agentId)
          const toolUses = data.message.content.filter(b => b.type === 'tool_use')
          console.log(`[SSE] Agent ${data.agentId} turn:`, toolUses.map(t => t.type === 'tool_use' ? t.name : '').join(', '))

          // Update game state based on tool uses
          for (const block of data.message.content) {
            if (block.type !== 'tool_use') continue

            const { name, input } = block

            queryClient.setQueryData<GameState>(['game-state'], (old) => {
              if (!old) return old
              const agent = old.agents.find(a => a.id === data.agentId)
              if (!agent) return old

              let updates: Partial<Agent> = {}

              if (name === 'travel' && input.area) {
                updates = { area: input.area as Agent['area'], action: `Traveling to ${input.area}`, status: 'busy' }
              } else if (name === 'explore') {
                updates = { action: `Exploring ${agent.area}`, status: 'busy' }
              } else if (name === 'wait') {
                updates = { action: 'Waiting', status: 'idle' }
              } else if (name === 'sleep') {
                updates = { action: 'Sleeping', status: 'sleeping' }
              } else if (name === 'harvest') {
                updates = { action: 'Harvesting', status: 'busy' }
              }

              return {
                ...old,
                agents: old.agents.map(a => a.id === data.agentId ? { ...a, ...updates } : a),
              }
            })
          }

          // Add to activity log
          const now = new Date()
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

          queryClient.setQueryData<ActivityEvent[]>(['activity-events'], (old = []) => [
            { id: `${Date.now()}-${Math.random()}`, time: timeStr, agent: agentName, message: data.message! },
            ...old,
          ])
        }

        if (data.type === 'TIME_UPDATE') {
          console.log(`[SSE] Time update: Day ${data.day}, ${data.timeOfDay}, ${data.season}`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              day: data.day ?? old.day,
              timeOfDay: data.timeOfDay ?? old.timeOfDay,
              season: data.season ?? old.season,
            }
          })
        }

        if (data.type === 'SEASON_CHANGE') {
          console.log(`[SSE] Season changed to ${data.season}`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              season: data.season ?? old.season,
              day: data.day ?? old.day,
            }
          })
        }

        // AGENT_UPDATE - authoritative state from DB after actions
        if (data.type === 'AGENT_UPDATE' && data.agent) {
          const { agent } = data
          console.log(`[SSE] Agent update: ${agent.name} now in ${agent.area}, status=${agent.status}`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              agents: old.agents.map(a => a.id === agent.id ? {
                ...a,
                area: agent.area,
                status: agent.status,
                action: agent.currentAction ?? 'Idle',
                turns: typeof agent.turns === 'string' ? parseFloat(agent.turns) : agent.turns,
                gold: agent.gold,
              } : a),
            }
          })
        }
      } catch (e) {
        console.error('[SSE] Failed to parse event:', e)
      }
    }

    globalEventSource?.addEventListener('message', handleMessage)

    return () => {
      connectionCount--
      globalEventSource?.removeEventListener('message', handleMessage)

      // Only close if no more components using it
      if (connectionCount === 0 && globalEventSource) {
        console.log('[SSE] Disconnecting')
        globalEventSource.close()
        globalEventSource = null
      }
    }
  }, [queryClient])
}
