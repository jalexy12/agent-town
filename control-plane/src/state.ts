import { agents, inventory, skills, world } from './db/repositories'
import type { Agent as DbAgent } from './db/repositories/agents'

export type Area = 'forest' | 'hills' | 'riverbank' | 'ruins' | 'commons'

export interface Agent {
  id: string
  name: string
  area: Area
  status: 'idle' | 'busy' | 'sleeping' | 'offline'
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

// Transform DB row to API shape
function toAgent(row: DbAgent): Agent {
  return {
    id: row.id,
    name: row.name,
    area: row.area as Area,
    status: row.status as Agent['status'],
    action: row.currentAction ?? 'Idle',
    turns: Number(row.turns), // DECIMAL comes as string
    gold: row.gold ?? 0,
  }
}

export async function getGameState(): Promise<GameState> {
  const [agentRows, worldState] = await Promise.all([
    agents.getAllAgents(),
    world.getAll(),
  ])

  return {
    agents: agentRows.map(toAgent),
    day: worldState.day?.valueInt ?? 1,
    season: worldState.season?.valueText ?? 'spring',
    timeOfDay: worldState.time_of_day?.valueText ?? 'day',
  }
}

export async function getAgent(id: string): Promise<Agent | null> {
  const row = await agents.getAgent(id)
  return row ? toAgent(row) : null
}

export async function getAgentsByArea(area: Area): Promise<Agent[]> {
  const rows = await agents.getAgentsByArea(area)
  return rows.map(toAgent)
}
