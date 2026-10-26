import { eq, and, isNull, sql } from 'drizzle-orm'
import { db, messages, world } from '../index'

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

export async function getUnreadMessages(toId: string) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.toId, toId), isNull(messages.readAt)))
}

export async function sendMessage(fromId: string, toId: string, content: string): Promise<string> {
  const id = crypto.randomUUID().slice(0, 12)

  // Get current game day
  const dayRow = await db.select().from(world).where(eq(world.keyName, 'day'))
  const gameDay = dayRow[0]?.valueInt ?? 1

  await db.insert(messages).values({
    id,
    fromId,
    toId,
    content,
    gameDay,
  })

  return id
}

export async function markAsRead(id: string) {
  await db.update(messages).set({ readAt: sql`NOW()` }).where(eq(messages.id, id))
}

export async function markAllAsRead(toId: string) {
  await db
    .update(messages)
    .set({ readAt: sql`NOW()` })
    .where(and(eq(messages.toId, toId), isNull(messages.readAt)))
}
