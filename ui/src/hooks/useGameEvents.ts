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
}

interface SSEEvent {
  type: 'TRAVEL' | 'EXPLORE' | 'WAIT' | 'connected'
  agentId?: string
  area?: Agent['area']
  thoughts?: string
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
      globalEventSource = new EventSource('http://localhost:4000/events')

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

        if (data.type === 'TRAVEL' && data.agentId && data.area) {
          console.log(`[SSE] Agent ${data.agentId} traveling to ${data.area}`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              agents: old.agents.map((a) =>
                a.id === data.agentId
                  ? { ...a, area: data.area!, action: `Traveling to ${data.area}`, status: 'busy' }
                  : a
              ),
            }
          })
        } else if (data.type === 'EXPLORE' && data.agentId) {
          console.log(`[SSE] Agent ${data.agentId} exploring ${data.area}`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              agents: old.agents.map((a) =>
                a.id === data.agentId
                  ? { ...a, action: `Exploring ${a.area}`, status: 'busy' }
                  : a
              ),
            }
          })
        } else if (data.type === 'WAIT' && data.agentId) {
          console.log(`[SSE] Agent ${data.agentId} waiting`)
          queryClient.setQueryData<GameState>(['game-state'], (old) => {
            if (!old) return old
            return {
              ...old,
              agents: old.agents.map((a) =>
                a.id === data.agentId
                  ? { ...a, action: 'Waiting', status: 'idle' }
                  : a
              ),
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
