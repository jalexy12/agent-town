import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, lazy, Suspense } from 'react'
import type { GameState, Agent, ActivityEvent } from '~/hooks/useGameEvents'
import { ActivityPanel } from '~/components/ActivityPanel'

export const Route = createFileRoute('/')({
  component: Game,
})

// Fallback data while loading
const INITIAL_AGENTS: Agent[] = [
  { id: 'alice', name: 'Alice', area: 'forest', status: 'busy', action: 'Harvesting Moonpetal', turns: 7, gold: 124 },
  { id: 'bob', name: 'Bob', area: 'hills', status: 'busy', action: 'Exploring', turns: 3, gold: 89 },
  { id: 'clara', name: 'Clara', area: 'commons', status: 'idle', action: 'At trading post', turns: 10, gold: 312 },
  { id: 'dex', name: 'Dex', area: 'riverbank', status: 'busy', action: 'Fishing', turns: 5, gold: 67 },
  { id: 'eva', name: 'Eva', area: 'ruins', status: 'idle', action: 'Resting', turns: 2, gold: 201 },
  { id: 'finn', name: 'Finn', area: 'forest', status: 'busy', action: 'Traveling to Hills', turns: 8, gold: 156 },
]

const AREA_COLORS_HEX: Record<string, string> = {
  forest: '#4a6741',
  hills: '#8b7355',
  riverbank: '#4a6b8a',
  ruins: '#6b5b73',
  commons: '#d4a574',
}

// Lazy load the PixiJS world (client-only)
const PixiWorld = lazy(() => import('../components/PixiWorld'))

function Game() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)

  // Fetch initial game state, SSE updates via setQueryData in useGameEvents
  const { data: gameState } = useQuery<GameState>({
    queryKey: ['game-state'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/state`)
      if (!res.ok) throw new Error('Failed to fetch game state')
      return res.json()
    },
    placeholderData: { agents: INITIAL_AGENTS, day: 1, season: 'spring', timeOfDay: 'day' },
    staleTime: Infinity,  // Once fetched, SSE handles updates
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',  // Always fetch real data on mount
    refetchOnReconnect: false,
  })

  // Query activity events - fetches history on load, SSE adds new events
  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity-events'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/events/history`)
      if (!res.ok) return []
      return res.json()
    },
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
  })

  const agents = gameState?.agents ?? INITIAL_AGENTS
  const agent = selectedAgent ? agents.find((a) => a.id === selectedAgent) : null

  useEffect(() => {
    setIsClient(true)
  }, [])

  return (
    <div className="h-screen w-screen bg-[var(--color-void)] relative overflow-hidden">
      {/* World View - PixiJS (offset for activity panel) */}
      <div className="absolute inset-0 right-[380px]">
        {isClient ? (
          <Suspense fallback={<WorldLoading />}>
            <PixiWorld
              agents={agents}
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
            />
          </Suspense>
        ) : (
          <WorldLoading />
        )}
      </div>

      {/* Top Left - Game Time */}
      <div className="absolute top-4 left-4 flex items-center gap-3 pointer-events-none">
        <div className="px-3 py-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10">
          <span className="text-xs text-[var(--color-fog)]">Day {gameState?.day ?? 1}</span>
          <span className="text-xs text-[var(--color-fog)] mx-2">·</span>
          <span className="text-xs text-[var(--color-forest)] capitalize">{gameState?.season ?? 'spring'}</span>
          <span className="text-xs text-[var(--color-fog)] mx-2">·</span>
          <span className="text-xs text-[var(--color-mist)] capitalize">{gameState?.timeOfDay ?? 'day'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-[var(--color-fog)]">Live</span>
        </div>
      </div>

      {/* Top Right - Minimap / Area Overview (offset for activity panel) */}
      <div className="absolute top-4 right-[400px] w-48 pointer-events-none">
        <div className="rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 p-3">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(AREA_COLORS_HEX).map(([area, color]) => {
              const count = agents.filter((a) => a.area === area).length
              return (
                <div key={area} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-[var(--color-mist)] capitalize">{area}</span>
                  {count > 0 && <span className="text-xs text-[var(--color-amber)]">{count}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Right Side - Activity Panel */}
      <ActivityPanel events={activityEvents} />

      {/* Bottom Left - Agent Portraits */}
      <div className="absolute bottom-4 left-4">
        <div className="flex gap-2">
          {agents.map((a) => (
            <AgentPortrait
              key={a.id}
              agent={a}
              selected={selectedAgent === a.id}
              onClick={() => setSelectedAgent(a.id === selectedAgent ? null : a.id)}
            />
          ))}
        </div>
      </div>

      {/* Selected Agent Panel */}
      {agent && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <AgentPanel agent={agent} onClose={() => setSelectedAgent(null)} />
        </div>
      )}
    </div>
  )
}

function WorldLoading() {
  return (
    <div className="w-full h-full bg-[#0a0f0a] flex items-center justify-center">
      <div className="text-[var(--color-fog)] text-sm">Loading world...</div>
    </div>
  )
}

function AgentPortrait({
  agent,
  selected,
  onClick,
}: {
  agent: Agent
  selected: boolean
  onClick: () => void
}) {
  const color = AREA_COLORS_HEX[agent.area]
  const statusColor =
    agent.status === 'busy' ? 'bg-amber-500' : agent.status === 'idle' ? 'bg-green-500' : 'bg-gray-500'

  return (
    <button
      onClick={onClick}
      className={`relative group transition-transform ${selected ? 'scale-110' : 'hover:scale-105'}`}
    >
      <div
        className={`w-12 h-12 rounded-lg flex items-center justify-center text-lg font-display text-[var(--color-void)] border-2 transition-colors ${
          selected ? 'border-[var(--color-amber)]' : 'border-transparent hover:border-white/30'
        }`}
        style={{ backgroundColor: color }}
      >
        {agent.name[0]}
      </div>
      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--color-void)] ${statusColor}`} />
      <div className="absolute -bottom-2 left-0 right-0 h-1 bg-black/50 rounded-full overflow-hidden">
        <div className="h-full bg-[var(--color-amber)] transition-all" style={{ width: `${(agent.turns / 10) * 100}%` }} />
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="px-2 py-1 rounded bg-black/90 border border-white/10 whitespace-nowrap">
          <p className="text-xs text-[var(--color-parchment)]">{agent.name}</p>
          <p className="text-xs text-[var(--color-fog)]">{agent.action}</p>
        </div>
      </div>
    </button>
  )
}

function AgentPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const color = AREA_COLORS_HEX[agent.area]

  return (
    <div className="rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 p-4 min-w-80">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-display text-[var(--color-void)]"
            style={{ backgroundColor: color }}
          >
            {agent.name[0]}
          </div>
          <div>
            <h2 className="font-display text-lg text-[var(--color-parchment)]">{agent.name}</h2>
            <p className="text-xs text-[var(--color-fog)] capitalize">{agent.area}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-[var(--color-fog)] hover:text-[var(--color-parchment)]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="text-sm text-[var(--color-mist)] mb-4">{agent.action}</div>
      <div className="flex gap-6 text-sm">
        <div>
          <span className="text-[var(--color-fog)]">Turns</span>
          <span className="ml-2 text-[var(--color-parchment)]">{agent.turns}/10</span>
        </div>
        <div>
          <span className="text-[var(--color-fog)]">Gold</span>
          <span className="ml-2 text-[var(--color-amber)]">{agent.gold}g</span>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-white/10 flex gap-2">
        <button className="flex-1 py-1.5 text-xs text-[var(--color-fog)] hover:text-[var(--color-amber)] transition-colors rounded border border-white/10 hover:border-[var(--color-amber)]/50">
          View Diary
        </button>
        <button className="flex-1 py-1.5 text-xs text-[var(--color-fog)] hover:text-[var(--color-amber)] transition-colors rounded border border-white/10 hover:border-[var(--color-amber)]/50">
          Inventory
        </button>
      </div>
    </div>
  )
}
