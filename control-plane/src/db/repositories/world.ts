import { eq } from 'drizzle-orm'
import { db, world } from '../index'

export type WorldKey = 'day' | 'season' | 'time_of_day' | 'scheduler_paused'

export async function getValue(key: WorldKey) {
  const rows = await db.select().from(world).where(eq(world.keyName, key))
  return rows[0] ?? null
}

export async function getAll() {
  const rows = await db.select().from(world)
  return rows.reduce((acc, row) => {
    acc[row.keyName as WorldKey] = row
    return acc
  }, {} as Record<WorldKey, typeof rows[0]>)
}

export async function setIntValue(key: WorldKey, value: number) {
  await db
    .insert(world)
    .values({ keyName: key, valueInt: value })
    .onDuplicateKeyUpdate({ set: { valueInt: value } })
}

export async function setTextValue(key: WorldKey, value: string) {
  await db
    .insert(world)
    .values({ keyName: key, valueText: value })
    .onDuplicateKeyUpdate({ set: { valueText: value } })
}

export async function incrementDay() {
  const current = await getValue('day')
  const newDay = (current?.valueInt ?? 0) + 1
  await setIntValue('day', newDay)
  return newDay
}

// Scheduler pause state (for safe sprite updates)
export async function isSchedulerPaused(): Promise<boolean> {
  const row = await getValue('scheduler_paused')
  return row?.valueInt === 1
}

export async function setSchedulerPaused(paused: boolean): Promise<void> {
  await setIntValue('scheduler_paused', paused ? 1 : 0)
}
