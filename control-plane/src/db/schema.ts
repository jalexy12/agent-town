import { mysqlTable, varchar, int, text, timestamp, mysqlEnum, decimal, json, primaryKey, index } from 'drizzle-orm/mysql-core'

// Enums
export const areaEnum = mysqlEnum('area', ['forest', 'hills', 'riverbank', 'ruins', 'commons'])
export const areaNoCommonsEnum = mysqlEnum('area', ['forest', 'hills', 'riverbank', 'ruins'])
export const statusEnum = mysqlEnum('status', ['idle', 'busy', 'sleeping', 'offline'])
export const skillTypeEnum = mysqlEnum('skill_type', ['mining', 'smithing', 'foraging', 'medicine', 'fishing'])
export const skillLevelEnum = mysqlEnum('skill_level', ['unskilled', 'novice', 'journeyman', 'expert', 'master'])
export const categoryEnum = mysqlEnum('category', ['ore', 'gem', 'herb', 'fish', 'artifact', 'food', 'tool', 'material', 'consumable'])
export const rarityEnum = mysqlEnum('rarity', ['common', 'uncommon', 'rare', 'legendary'])
export const seasonEnum = mysqlEnum('season', ['spring', 'summer', 'fall', 'winter'])
export const timeOfDayEnum = mysqlEnum('time_of_day', ['dawn', 'day', 'dusk', 'night'])
export const eventTypeEnum = mysqlEnum('event_type', ['discovery', 'harvest', 'craft', 'trade', 'travel', 'message', 'spawn', 'deplete', 'level_up', 'turn'])
export const recipeSkillEnum = mysqlEnum('recipe_skill', ['smithing', 'medicine', 'crafting'])

// Items - loot definitions
export const items = mysqlTable('items', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  category: categoryEnum.notNull(),
  rarity: rarityEnum.notNull(),
  baseValue: int('base_value').notNull().default(1),
  skillType: skillTypeEnum,
  skillReq: skillLevelEnum.default('unskilled'),
  seasonOnly: seasonEnum,
  timeOnly: timeOfDayEnum,
  description: text('description'),
}, (table) => [
  index('idx_category').on(table.category),
  index('idx_rarity').on(table.rarity),
])

// Spawn tables - drop weights by area
export const spawnTables = mysqlTable('spawn_tables', {
  id: int('id').primaryKey().autoincrement(),
  area: areaNoCommonsEnum.notNull(),
  itemId: varchar('item_id', { length: 32 }).notNull(),
  weight: int('weight').notNull().default(100),
  minRichness: int('min_richness').default(1),
  maxRichness: int('max_richness').default(5),
}, (table) => [
  index('idx_area').on(table.area),
])

// Active spawns in the world
export const spawns = mysqlTable('spawns', {
  id: varchar('id', { length: 32 }).primaryKey(),
  itemId: varchar('item_id', { length: 32 }).notNull(),
  area: areaNoCommonsEnum.notNull(),
  x: int('x').notNull(),
  y: int('y').notNull(),
  richness: int('richness').notNull(),
  discoveredBy: varchar('discovered_by', { length: 32 }),
  discoveredAt: timestamp('discovered_at'),
  createdAt: timestamp('created_at').defaultNow(),
  depletedAt: timestamp('depleted_at'),
}, (table) => [
  index('idx_area_active').on(table.area, table.depletedAt),
  index('idx_item').on(table.itemId),
])

// Recipes
export const recipes = mysqlTable('recipes', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  skillType: recipeSkillEnum.notNull(),
  skillReq: skillLevelEnum.notNull(),
  outputItemId: varchar('output_item_id', { length: 32 }).notNull(),
  outputQuantity: int('output_quantity').default(1),
  turnCost: int('turn_cost').default(1),
})

// Recipe ingredients
export const recipeIngredients = mysqlTable('recipe_ingredients', {
  recipeId: varchar('recipe_id', { length: 32 }).notNull(),
  itemId: varchar('item_id', { length: 32 }).notNull(),
  quantity: int('quantity').notNull(),
}, (table) => [
  primaryKey({ columns: [table.recipeId, table.itemId] }),
])

// Agents
export const agents = mysqlTable('agents', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  spriteUrl: varchar('sprite_url', { length: 128 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  area: areaEnum.default('commons'),
  gold: int('gold').default(50),
  turns: decimal('turns', { precision: 4, scale: 2 }).default('10.00'),
  status: statusEnum.default('idle'),
  currentAction: varchar('current_action', { length: 64 }),
  actionCompletesAt: timestamp('action_completes_at'),
  actionData: json('action_data'),
  createdAt: timestamp('created_at').defaultNow(),
})

// Agent skills
export const agentSkills = mysqlTable('agent_skills', {
  agentId: varchar('agent_id', { length: 32 }).notNull(),
  skill: skillTypeEnum.notNull(),
  level: skillLevelEnum.default('unskilled'),
  xp: int('xp').default(0),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.skill] }),
])

// Agent inventory
export const agentInventory = mysqlTable('agent_inventory', {
  agentId: varchar('agent_id', { length: 32 }).notNull(),
  itemId: varchar('item_id', { length: 32 }).notNull(),
  quantity: int('quantity').notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.itemId] }),
])

// Trading post listings
export const listings = mysqlTable('listings', {
  id: varchar('id', { length: 32 }).primaryKey(),
  sellerId: varchar('seller_id', { length: 32 }).notNull(),
  itemId: varchar('item_id', { length: 32 }).notNull(),
  quantity: int('quantity').notNull(),
  priceEach: int('price_each').notNull(),
  listedAt: timestamp('listed_at').defaultNow(),
  soldAt: timestamp('sold_at'),
  buyerId: varchar('buyer_id', { length: 32 }),
}, (table) => [
  index('idx_active').on(table.soldAt),
  index('idx_item').on(table.itemId),
])

// Events for activity feed
export const events = mysqlTable('events', {
  id: varchar('id', { length: 32 }).primaryKey(),
  type: eventTypeEnum.notNull(),
  agentId: varchar('agent_id', { length: 32 }),
  data: json('data').notNull(),
  gameDay: int('game_day').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_created').on(table.createdAt),
  index('idx_type').on(table.type),
])

// World state key-value store
export const world = mysqlTable('world', {
  keyName: varchar('key_name', { length: 32 }).primaryKey(),
  valueInt: int('value_int'),
  valueText: varchar('value_text', { length: 64 }),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
})

// Inter-agent messages
export const messages = mysqlTable('messages', {
  id: varchar('id', { length: 32 }).primaryKey(),
  fromId: varchar('from_id', { length: 32 }).notNull(),
  toId: varchar('to_id', { length: 32 }).notNull(),
  content: text('content').notNull(),
  gameDay: int('game_day').notNull(),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_to_unread').on(table.toId, table.readAt),
])

// Agent sessions - conversation state for agentic loop
export const sessions = mysqlTable('sessions', {
  agentId: varchar('agent_id', { length: 32 }).primaryKey(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  messages: json('messages').notNull(), // Array of Anthropic message params
  pendingToolUseId: varchar('pending_tool_use_id', { length: 64 }),
  actionCount: int('action_count').default(0),
  startedAt: timestamp('started_at').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
})
