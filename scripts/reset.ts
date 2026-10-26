/**
 * Reset Script
 *
 * Resets game state while preserving sprite URLs.
 * Run with: bun run db:reset
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { eq } from 'drizzle-orm'

const { db, agents, agentSkills, agentInventory, events, messages, listings, spawns, world } = await import('../control-plane/src/db')

// Initial agent state (matches seed.ts but preserves spriteUrl)
const INITIAL_AGENTS = [
  { id: 'alice', area: 'forest', gold: 124, turns: '7.00', status: 'idle', currentAction: 'Resting' },
  { id: 'bob', area: 'hills', gold: 89, turns: '3.00', status: 'idle', currentAction: 'Resting' },
  { id: 'clara', area: 'commons', gold: 312, turns: '10.00', status: 'idle', currentAction: 'At trading post' },
  { id: 'dex', area: 'riverbank', gold: 67, turns: '5.00', status: 'idle', currentAction: 'Resting' },
  { id: 'eva', area: 'ruins', gold: 201, turns: '2.00', status: 'idle', currentAction: 'Resting' },
  { id: 'finn', area: 'forest', gold: 156, turns: '8.00', status: 'idle', currentAction: 'Resting' },
] as const

// Initial skills (matches seed.ts)
const INITIAL_SKILLS = [
  { agentId: 'alice', skill: 'foraging', level: 'novice', xp: 150 },
  { agentId: 'bob', skill: 'mining', level: 'novice', xp: 120 },
  { agentId: 'dex', skill: 'fishing', level: 'novice', xp: 100 },
  { agentId: 'eva', skill: 'foraging', level: 'novice', xp: 80 },
] as const

async function reset() {
  console.log('Resetting game state...')

  // Clear transient tables
  console.log('Clearing events...')
  await db.delete(events)

  console.log('Clearing messages...')
  await db.delete(messages)

  console.log('Clearing listings...')
  await db.delete(listings)

  console.log('Clearing spawns...')
  await db.delete(spawns)

  console.log('Clearing inventory...')
  await db.delete(agentInventory)

  // Reset agent state (preserve spriteUrl)
  console.log('Resetting agents...')
  for (const agent of INITIAL_AGENTS) {
    await db.update(agents)
      .set({
        area: agent.area,
        gold: agent.gold,
        turns: agent.turns,
        status: agent.status,
        currentAction: agent.currentAction,
        actionCompletesAt: null,
        actionData: null,
      })
      .where(eq(agents.id, agent.id))
  }

  // Reset skills
  console.log('Resetting skills...')
  await db.delete(agentSkills)

  const skillTypes = ['mining', 'smithing', 'foraging', 'medicine', 'fishing'] as const
  const agentIds = ['alice', 'bob', 'clara', 'dex', 'eva', 'finn']

  const skillValues: Array<{ agentId: string; skill: typeof skillTypes[number]; level: 'unskilled' | 'novice'; xp: number }> = []

  for (const agentId of agentIds) {
    for (const skill of skillTypes) {
      const initial = INITIAL_SKILLS.find(s => s.agentId === agentId && s.skill === skill)
      skillValues.push({
        agentId,
        skill,
        level: initial?.level ?? 'unskilled',
        xp: initial?.xp ?? 0,
      })
    }
  }

  await db.insert(agentSkills).values(skillValues)

  // Reset world state
  console.log('Resetting world state...')
  await db.update(world).set({ valueInt: 1 }).where(eq(world.keyName, 'day'))
  await db.update(world).set({ valueText: 'spring' }).where(eq(world.keyName, 'season'))
  await db.update(world).set({ valueText: 'day' }).where(eq(world.keyName, 'time_of_day'))

  console.log('Done! Game state reset to day 1.')
}

reset().catch(console.error)
