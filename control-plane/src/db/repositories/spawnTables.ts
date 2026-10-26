import { eq } from 'drizzle-orm'
import { db, spawnTables } from '../index'

export type SpawnTable = typeof spawnTables.$inferSelect

export async function getSpawnTableForArea(area: 'forest' | 'hills' | 'riverbank' | 'ruins') {
  return db.select().from(spawnTables).where(eq(spawnTables.area, area))
}
