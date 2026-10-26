import { eq, and, sql } from 'drizzle-orm'
import { db, agentInventory, items } from '../index'

export async function getAgentInventory(agentId: string) {
  return db
    .select({
      itemId: agentInventory.itemId,
      quantity: agentInventory.quantity,
      name: items.name,
      category: items.category,
    })
    .from(agentInventory)
    .innerJoin(items, eq(agentInventory.itemId, items.id))
    .where(eq(agentInventory.agentId, agentId))
}

export async function addToInventory(agentId: string, itemId: string, quantity: number) {
  // MySQL upsert
  await db
    .insert(agentInventory)
    .values({ agentId, itemId, quantity })
    .onDuplicateKeyUpdate({
      set: { quantity: sql`${agentInventory.quantity} + ${quantity}` },
    })
}

export async function removeFromInventory(agentId: string, itemId: string, quantity: number) {
  await db
    .update(agentInventory)
    .set({ quantity: sql`${agentInventory.quantity} - ${quantity}` })
    .where(and(eq(agentInventory.agentId, agentId), eq(agentInventory.itemId, itemId)))
}

export async function getInventoryItem(agentId: string, itemId: string) {
  const rows = await db
    .select()
    .from(agentInventory)
    .where(and(eq(agentInventory.agentId, agentId), eq(agentInventory.itemId, itemId)))
  return rows[0] ?? null
}
