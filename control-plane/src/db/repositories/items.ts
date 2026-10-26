import { eq } from 'drizzle-orm'
import { db, items } from '../index'

export type Item = typeof items.$inferSelect

export async function getItem(id: string) {
  const rows = await db.select().from(items).where(eq(items.id, id))
  return rows[0] ?? null
}
