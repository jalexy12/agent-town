import { eq, desc } from 'drizzle-orm'
import { db, events, world } from '../index'

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type EventType = NewEvent['type']

export async function recordEvent(
  type: EventType,
  agentId: string | null,
  data: Record<string, unknown>
): Promise<string> {
  const id = crypto.randomUUID().slice(0, 12)

  // Get current game day
  const dayRow = await db.select().from(world).where(eq(world.keyName, 'day'))
  const gameDay = dayRow[0]?.valueInt ?? 1

  await db.insert(events).values({
    id,
    type,
    agentId,
    data,
    gameDay,
  })

  return id
}

export async function getRecentEvents() {
  return db
    .select()
    .from(events)
    .orderBy(desc(events.createdAt))
}

export async function getEventsByAgent(agentId: string, limit = 20) {
  return db
    .select()
    .from(events)
    .where(eq(events.agentId, agentId))
    .orderBy(desc(events.createdAt))
    .limit(limit)
}
