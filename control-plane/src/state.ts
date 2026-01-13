export type Area = 'forest' | 'hills' | 'riverbank' | 'ruins' | 'commons'

export interface Agent {
  id: string
  name: string
  area: Area
  status: 'idle' | 'busy'
  action: string
  turns: number
  gold: number
}

// In-memory game state - matches UI mock data
export const agents = new Map<string, Agent>([
  ['alice', { id: 'alice', name: 'Alice', area: 'forest', status: 'busy', action: 'Harvesting Moonpetal', turns: 7, gold: 124 }],
  ['bob', { id: 'bob', name: 'Bob', area: 'hills', status: 'busy', action: 'Exploring', turns: 3, gold: 89 }],
  ['clara', { id: 'clara', name: 'Clara', area: 'commons', status: 'idle', action: 'At trading post', turns: 10, gold: 312 }],
  ['dex', { id: 'dex', name: 'Dex', area: 'riverbank', status: 'busy', action: 'Fishing', turns: 5, gold: 67 }],
  ['eva', { id: 'eva', name: 'Eva', area: 'ruins', status: 'idle', action: 'Resting', turns: 2, gold: 201 }],
  ['finn', { id: 'finn', name: 'Finn', area: 'forest', status: 'busy', action: 'Traveling to Hills', turns: 8, gold: 156 }],
])

export interface GameState {
  agents: Agent[]
  day: number
  season: string
}

export function getGameState(): GameState {
  return {
    agents: Array.from(agents.values()),
    day: 27,
    season: 'spring',
  }
}
