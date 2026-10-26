import { eq, and, lte, inArray, lt, sql } from 'drizzle-orm'
import { db, agents } from '../index'

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

export async function getAllAgents() {
  return db.select().from(agents)
}

export async function getAgentsWithCompletedActions() {
  return db.select().from(agents).where(
    and(
      eq(agents.status, 'busy'),
      lte(agents.actionCompletesAt, new Date())
    )
  )
}

export async function getAgentsForTurnRegen() {
  return db.select().from(agents).where(
    and(
      inArray(agents.status, ['idle', 'sleeping']),
      lt(agents.turns, sql`10`)
    )
  )
}

export async function getIdleAgentsWithTurns() {
  return db.select().from(agents).where(
    and(
      eq(agents.status, 'idle'),
      sql`${agents.turns} >= 1`  // Need at least 1 turn to act
    )
  )
}

export async function getAgent(id: string) {
  const rows = await db.select().from(agents).where(eq(agents.id, id))
  return rows[0] ?? null
}

export async function getAgentsByArea(area: NonNullable<Agent['area']>) {
  return db.select().from(agents).where(eq(agents.area, area))
}

export async function updateAgent(id: string, updates: Partial<Omit<Agent, 'id' | 'createdAt'>>) {
  await db.update(agents).set(updates).where(eq(agents.id, id))
}

export async function createAgent(agent: NewAgent) {
  await db.insert(agents).values(agent)
}

export async function addGold(id: string, amount: number) {
  await db.update(agents).set({ gold: sql`${agents.gold} + ${amount}` }).where(eq(agents.id, id))
}

export async function deductGold(id: string, amount: number) {
  await db.update(agents).set({ gold: sql`${agents.gold} - ${amount}` }).where(eq(agents.id, id))
}

export async function deductTurn(id: string) {
  await db.update(agents).set({ turns: sql`GREATEST(0, ${agents.turns} - 1)` }).where(eq(agents.id, id))
}
