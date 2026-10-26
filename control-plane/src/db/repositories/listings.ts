import { eq, and, isNull, sql } from 'drizzle-orm'
import { db, listings, items } from '../index'

export type Listing = typeof listings.$inferSelect
export type NewListing = typeof listings.$inferInsert

export async function getActiveListings() {
  return db
    .select({
      id: listings.id,
      sellerId: listings.sellerId,
      itemId: listings.itemId,
      itemName: items.name,
      quantity: listings.quantity,
      priceEach: listings.priceEach,
      listedAt: listings.listedAt,
    })
    .from(listings)
    .innerJoin(items, eq(listings.itemId, items.id))
    .where(isNull(listings.soldAt))
}

export async function getListing(id: string) {
  const rows = await db.select().from(listings).where(eq(listings.id, id))
  return rows[0] ?? null
}

export async function createListing(listing: NewListing) {
  await db.insert(listings).values(listing)
}

export async function completeSale(id: string, buyerId: string) {
  await db
    .update(listings)
    .set({ soldAt: sql`NOW()`, buyerId })
    .where(eq(listings.id, id))
}
