import { eq, and, isNull, sql } from 'drizzle-orm'
import { db, spawns, items } from '../index'

export type Spawn = typeof spawns.$inferSelect
export type NewSpawn = typeof spawns.$inferInsert

export async function getActiveSpawnsInArea(area: Spawn['area']) {
  return db
    .select({
      id: spawns.id,
      itemId: spawns.itemId,
      itemName: items.name,
      richness: spawns.richness,
      x: spawns.x,
      y: spawns.y,
      discoveredBy: spawns.discoveredBy,
    })
    .from(spawns)
    .innerJoin(items, eq(spawns.itemId, items.id))
    .where(and(eq(spawns.area, area), isNull(spawns.depletedAt)))
}

export async function getSpawn(id: string) {
  const rows = await db.select().from(spawns).where(eq(spawns.id, id))
  return rows[0] ?? null
}

export async function createSpawn(spawn: NewSpawn) {
  await db.insert(spawns).values(spawn)
}

export async function updateSpawnRichness(id: string, richness: number) {
  await db.update(spawns).set({ richness }).where(eq(spawns.id, id))
}

export async function depleteSpawn(id: string) {
  await db.update(spawns).set({ depletedAt: sql`NOW()` }).where(eq(spawns.id, id))
}

export async function discoverSpawn(id: string, agentId: string) {
  await db
    .update(spawns)
    .set({ discoveredBy: agentId, discoveredAt: sql`NOW()` })
    .where(eq(spawns.id, id))
}
