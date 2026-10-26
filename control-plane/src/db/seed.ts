import { sql } from 'drizzle-orm'
import { db, items, spawnTables, agents, agentSkills, world } from './index'

async function seed() {
  console.log('Seeding database...')

  // Seed items
  await db.insert(items).values([
    // Herbs (Foraging)
    { id: 'moonpetal', name: 'Moonpetal', category: 'herb', rarity: 'uncommon', baseValue: 15, skillType: 'foraging', skillReq: 'novice', description: 'A luminescent flower that blooms at night' },
    { id: 'healroot', name: 'Healroot', category: 'herb', rarity: 'common', baseValue: 8, skillType: 'foraging', skillReq: 'unskilled', description: 'A common medicinal herb' },
    { id: 'shadowmoss', name: 'Shadowmoss', category: 'herb', rarity: 'rare', baseValue: 35, skillType: 'foraging', skillReq: 'journeyman', description: 'Dark moss found in ancient ruins' },
    { id: 'sunleaf', name: 'Sunleaf', category: 'herb', rarity: 'common', baseValue: 5, skillType: 'foraging', skillReq: 'unskilled', description: 'Bright leaves that grow in clearings' },

    // Ores (Mining)
    { id: 'iron_ore', name: 'Iron Ore', category: 'ore', rarity: 'common', baseValue: 8, skillType: 'mining', skillReq: 'unskilled', description: 'Raw iron ore' },
    { id: 'copper_ore', name: 'Copper Ore', category: 'ore', rarity: 'common', baseValue: 6, skillType: 'mining', skillReq: 'unskilled', description: 'Reddish copper ore' },
    { id: 'silver_ore', name: 'Silver Ore', category: 'ore', rarity: 'uncommon', baseValue: 25, skillType: 'mining', skillReq: 'novice', description: 'Gleaming silver ore' },
    { id: 'gold_ore', name: 'Gold Ore', category: 'ore', rarity: 'rare', baseValue: 50, skillType: 'mining', skillReq: 'journeyman', description: 'Precious gold ore' },

    // Gems (Mining)
    { id: 'quartz', name: 'Quartz Crystal', category: 'gem', rarity: 'common', baseValue: 12, skillType: 'mining', skillReq: 'novice', description: 'Clear quartz crystal' },
    { id: 'amethyst', name: 'Amethyst', category: 'gem', rarity: 'uncommon', baseValue: 30, skillType: 'mining', skillReq: 'journeyman', description: 'Purple gemstone' },

    // Fish (Fishing)
    { id: 'river_trout', name: 'River Trout', category: 'fish', rarity: 'common', baseValue: 5, skillType: 'fishing', skillReq: 'unskilled', description: 'Common freshwater fish' },
    { id: 'silverscale', name: 'Silverscale', category: 'fish', rarity: 'uncommon', baseValue: 18, skillType: 'fishing', skillReq: 'novice', description: 'A fish with shimmering scales' },
    { id: 'ancient_carp', name: 'Ancient Carp', category: 'fish', rarity: 'rare', baseValue: 40, skillType: 'fishing', skillReq: 'journeyman', description: 'An ancient fish species' },

    // Artifacts
    { id: 'old_coin', name: 'Old Coin', category: 'artifact', rarity: 'uncommon', baseValue: 20, description: 'A worn coin from a forgotten era' },
    { id: 'ancient_shard', name: 'Ancient Shard', category: 'artifact', rarity: 'rare', baseValue: 45, description: 'A fragment of something ancient' },
  ]).onDuplicateKeyUpdate({ set: { id: sql`id` } }) // no-op update

  console.log('Items seeded')

  // Seed spawn tables
  await db.insert(spawnTables).values([
    // Forest spawns
    { area: 'forest', itemId: 'healroot', weight: 100, minRichness: 1, maxRichness: 4 },
    { area: 'forest', itemId: 'moonpetal', weight: 40, minRichness: 1, maxRichness: 3 },
    { area: 'forest', itemId: 'sunleaf', weight: 80, minRichness: 2, maxRichness: 5 },

    // Hills spawns
    { area: 'hills', itemId: 'iron_ore', weight: 100, minRichness: 2, maxRichness: 5 },
    { area: 'hills', itemId: 'copper_ore', weight: 80, minRichness: 2, maxRichness: 4 },
    { area: 'hills', itemId: 'silver_ore', weight: 30, minRichness: 1, maxRichness: 3 },
    { area: 'hills', itemId: 'quartz', weight: 40, minRichness: 1, maxRichness: 2 },
    { area: 'hills', itemId: 'gold_ore', weight: 10, minRichness: 1, maxRichness: 2 },
    { area: 'hills', itemId: 'amethyst', weight: 15, minRichness: 1, maxRichness: 1 },

    // Riverbank spawns
    { area: 'riverbank', itemId: 'river_trout', weight: 100, minRichness: 2, maxRichness: 5 },
    { area: 'riverbank', itemId: 'silverscale', weight: 40, minRichness: 1, maxRichness: 3 },
    { area: 'riverbank', itemId: 'ancient_carp', weight: 15, minRichness: 1, maxRichness: 2 },
    { area: 'riverbank', itemId: 'healroot', weight: 30, minRichness: 1, maxRichness: 2 },

    // Ruins spawns
    { area: 'ruins', itemId: 'old_coin', weight: 60, minRichness: 1, maxRichness: 3 },
    { area: 'ruins', itemId: 'ancient_shard', weight: 25, minRichness: 1, maxRichness: 2 },
    { area: 'ruins', itemId: 'shadowmoss', weight: 40, minRichness: 1, maxRichness: 3 },
  ]).onDuplicateKeyUpdate({ set: { id: sql`id` } })

  console.log('Spawn tables seeded')

  // Seed agents
  await db.insert(agents).values([
    { id: 'alice', name: 'Alice', spriteUrl: 'http://localhost:4001', color: '#4a6741', area: 'forest', gold: 124, turns: '7.00', status: 'idle', currentAction: 'Resting' },
    { id: 'bob', name: 'Bob', spriteUrl: 'http://localhost:4002', color: '#8b7355', area: 'hills', gold: 89, turns: '3.00', status: 'idle', currentAction: 'Resting' },
    { id: 'clara', name: 'Clara', spriteUrl: 'http://localhost:4003', color: '#d4a574', area: 'commons', gold: 312, turns: '10.00', status: 'idle', currentAction: 'At trading post' },
    { id: 'dex', name: 'Dex', spriteUrl: 'http://localhost:4004', color: '#4a6b8a', area: 'riverbank', gold: 67, turns: '5.00', status: 'idle', currentAction: 'Resting' },
    { id: 'eva', name: 'Eva', spriteUrl: 'http://localhost:4005', color: '#6b5b73', area: 'ruins', gold: 201, turns: '2.00', status: 'idle', currentAction: 'Resting' },
    { id: 'finn', name: 'Finn', spriteUrl: 'http://localhost:4006', color: '#5a7a5a', area: 'forest', gold: 156, turns: '8.00', status: 'idle', currentAction: 'Resting' },
  ]).onDuplicateKeyUpdate({ set: { id: sql`id` } })

  console.log('Agents seeded')

  // Seed agent skills
  const skillTypes = ['mining', 'smithing', 'foraging', 'medicine', 'fishing'] as const
  const agentIds = ['alice', 'bob', 'clara', 'dex', 'eva', 'finn']

  const skillValues: Array<{ agentId: string; skill: typeof skillTypes[number]; level: 'unskilled' | 'novice'; xp: number }> = []

  for (const agentId of agentIds) {
    for (const skill of skillTypes) {
      // Give agents some starting skills based on their starting area
      let level: 'unskilled' | 'novice' = 'unskilled'
      let xp = 0

      if (agentId === 'alice' && skill === 'foraging') { level = 'novice'; xp = 150 }
      if (agentId === 'bob' && skill === 'mining') { level = 'novice'; xp = 120 }
      if (agentId === 'dex' && skill === 'fishing') { level = 'novice'; xp = 100 }
      if (agentId === 'eva' && skill === 'foraging') { level = 'novice'; xp = 80 }

      skillValues.push({ agentId, skill, level, xp })
    }
  }

  await db.insert(agentSkills).values(skillValues).onDuplicateKeyUpdate({ set: { agentId: sql`agent_id` } })

  console.log('Agent skills seeded')

  // Seed world state
  await db.insert(world).values([
    { keyName: 'day', valueInt: 1 },
    { keyName: 'season', valueText: 'spring' },
    { keyName: 'time_of_day', valueText: 'day' },
  ]).onDuplicateKeyUpdate({ set: { keyName: sql`key_name` } })

  console.log('World state seeded')

  console.log('Database seeded successfully!')
}

seed().catch(console.error)
