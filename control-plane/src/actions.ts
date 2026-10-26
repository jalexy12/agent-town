import { agents, listings, messages, events, spawns, inventory, spawnTables, items } from './db/repositories'
import type { Area } from './state'

const TIME_SCALE = Number(process.env.TIME_SCALE) || 1

// Duration in ms (will be scaled by TIME_SCALE)
const ACTION_DURATIONS: Record<string, number> = {
  explore: 30 * 60 * 1000,    // 30 min
  harvest: 20 * 60 * 1000,    // 20 min (avg)
  travel: 15 * 60 * 1000,     // 15 min
  craft: 30 * 60 * 1000,      // 30 min (avg)
  // Instant actions:
  list_item: 0,
  buy_listing: 0,
  view_listings: 0,
  send_message: 0,
  wait: 0,
  sleep: 0,  // Special: status = sleeping, no completion time
}

export interface ActionResult {
  success: boolean
  duration: number  // 0 = instant or sleep
  result?: unknown
  error?: string
}

export interface ToolUse {
  name: string
  input: Record<string, unknown>
}

export async function executeAction(
  agentId: string,
  toolUse: ToolUse
): Promise<ActionResult> {
  const { name, input } = toolUse
  const agent = await agents.getAgent(agentId)
  if (!agent) return { success: false, duration: 0, error: 'Agent not found' }

  const baseDuration = ACTION_DURATIONS[name] ?? 0
  const duration = Math.round(baseDuration * TIME_SCALE)

  switch (name) {
    case 'travel': {
      const area = input.area as Area
      const completesAt = duration > 0 ? new Date(Date.now() + duration) : null
      await agents.updateAgent(agentId, {
        area,
        currentAction: `Traveling to ${area}`,
        status: 'busy',
        actionCompletesAt: completesAt,
      })
      await events.recordEvent('travel', agentId, { to: area })
      return { success: true, duration, result: { arrived: area } }
    }

    case 'explore': {
      const completesAt = new Date(Date.now() + duration)
      await agents.updateAgent(agentId, {
        currentAction: `Exploring ${agent.area}`,
        status: 'busy',
        actionCompletesAt: completesAt,
      })
      await events.recordEvent('discovery', agentId, { area: agent.area })
      return { success: true, duration, result: { exploring: agent.area } }
    }

    case 'harvest': {
      const spawnId = input.spawn_id as string
      const completesAt = new Date(Date.now() + duration)
      await agents.updateAgent(agentId, {
        currentAction: 'Harvesting',
        status: 'busy',
        actionCompletesAt: completesAt,
        actionData: { spawnId },
      })
      await events.recordEvent('harvest', agentId, { spawnId })
      return { success: true, duration, result: { harvesting: spawnId } }
    }

    case 'craft': {
      const recipeId = input.recipe_id as string
      const completesAt = new Date(Date.now() + duration)
      await agents.updateAgent(agentId, {
        currentAction: 'Crafting',
        status: 'busy',
        actionCompletesAt: completesAt,
        actionData: { recipeId },
      })
      await events.recordEvent('craft', agentId, { recipeId })
      return { success: true, duration, result: { crafting: recipeId } }
    }

    case 'sleep': {
      await agents.updateAgent(agentId, {
        currentAction: 'Sleeping',
        status: 'sleeping',
        actionCompletesAt: null,  // Wakes when turns full
      })
      return { success: true, duration: 0 }  // No immediate follow-up
    }

    case 'wait': {
      await agents.updateAgent(agentId, {
        currentAction: null,
        status: 'idle',
        actionCompletesAt: null,
      })
      return { success: true, duration: 0, result: { waited: true } }
    }

    case 'send_message': {
      await messages.sendMessage(agentId, input.to as string, input.content as string)
      await events.recordEvent('message', agentId, { to: input.to, content: input.content })
      return { success: true, duration: 0, result: { sent: true } }
    }

    case 'view_listings': {
      // Must be in commons to view trading post
      if (agent.area !== 'commons') {
        return { success: false, duration: 0, error: 'Must be in commons to view trading post' }
      }

      const activeListings = await listings.getActiveListings()
      return {
        success: true,
        duration: 0,
        result: {
          listings: activeListings.map(l => ({
            id: l.id,
            item: l.itemName,
            quantity: l.quantity,
            price: l.priceEach,
            seller: l.sellerId,
          })),
        },
      }
    }

    case 'list_item': {
      // Must be in commons to list items
      if (agent.area !== 'commons') {
        return { success: false, duration: 0, error: 'Must be in commons to list items' }
      }

      const itemId = input.item_id as string
      const quantity = input.quantity as number
      const priceEach = input.price_each as number

      // Check if agent has enough items
      const inventoryItem = await inventory.getInventoryItem(agentId, itemId)
      if (!inventoryItem || inventoryItem.quantity < quantity) {
        return {
          success: false,
          duration: 0,
          error: `Not enough ${itemId} in inventory (have: ${inventoryItem?.quantity ?? 0}, need: ${quantity})`,
        }
      }

      // Remove items from seller's inventory
      await inventory.removeFromInventory(agentId, itemId, quantity)

      // Create listing
      const listingId = crypto.randomUUID().slice(0, 12)
      await listings.createListing({
        id: listingId,
        sellerId: agentId,
        itemId,
        quantity,
        priceEach,
      })

      await events.recordEvent('trade', agentId, { action: 'list', itemId, quantity, priceEach })
      return { success: true, duration: 0, result: { listed: listingId } }
    }

    case 'buy_listing': {
      // Must be in commons to buy
      if (agent.area !== 'commons') {
        return { success: false, duration: 0, error: 'Must be in commons to buy items' }
      }

      const listingId = input.listing_id as string

      // Get listing details
      const listing = await listings.getListing(listingId)
      if (!listing) {
        return { success: false, duration: 0, error: 'Listing not found' }
      }
      if (listing.soldAt) {
        return { success: false, duration: 0, error: 'Listing already sold' }
      }
      if (listing.sellerId === agentId) {
        return { success: false, duration: 0, error: 'Cannot buy your own listing' }
      }

      const totalCost = listing.quantity * listing.priceEach

      // Check if buyer has enough gold
      if ((agent.gold ?? 0) < totalCost) {
        return {
          success: false,
          duration: 0,
          error: `Not enough gold (have: ${agent.gold}, need: ${totalCost})`,
        }
      }

      // Transfer gold: buyer → seller
      await agents.deductGold(agentId, totalCost)
      await agents.addGold(listing.sellerId, totalCost)

      // Transfer items: listing → buyer
      await inventory.addToInventory(agentId, listing.itemId, listing.quantity)

      // Mark listing as sold
      await listings.completeSale(listingId, agentId)

      await events.recordEvent('trade', agentId, {
        action: 'buy',
        listingId,
        itemId: listing.itemId,
        quantity: listing.quantity,
        totalCost,
        sellerId: listing.sellerId,
      })

      return {
        success: true,
        duration: 0,
        result: {
          bought: listingId,
          item: listing.itemId,
          quantity: listing.quantity,
          spent: totalCost,
        },
      }
    }

    case 'view_listings': {
      // Get all active listings
      const activeListings = await listings.getActiveListings()

      return {
        success: true,
        duration: 0,
        result: {
          listings: activeListings.map(l => ({
            id: l.id,
            seller: l.sellerId,
            item: l.itemId,
            itemName: l.itemName,
            quantity: l.quantity,
            priceEach: l.priceEach,
            totalPrice: l.quantity * l.priceEach,
          })),
        },
      }
    }

    default:
      return { success: false, duration: 0, error: `Unknown action: ${name}` }
  }
}

// Action completion handling
export interface ActionCompletionResult {
  type: string
  success: boolean
  result?: unknown
  error?: string
}

export async function completeAction(agentId: string): Promise<ActionCompletionResult> {
  const agent = await agents.getAgent(agentId)
  if (!agent) return { type: 'unknown', success: false, error: 'Agent not found' }

  const action = agent.currentAction
  const data = agent.actionData as Record<string, unknown> | null

  if (action?.startsWith('Exploring')) {
    return completeExplore(agentId, agent.area as 'forest' | 'hills' | 'riverbank' | 'ruins')
  }
  if (action?.startsWith('Harvesting')) {
    return completeHarvest(agentId, data?.spawnId as string)
  }
  if (action?.startsWith('Traveling')) {
    return { type: 'travel', success: true, result: { arrived: agent.area } }
  }
  if (action?.startsWith('Crafting')) {
    return completeCraft(agentId, data?.recipeId as string)
  }

  return { type: 'unknown', success: true, result: {} }
}

// Weighted random selection helper
function weightedRandom<T extends { weight: number }>(items: T[]): T | null {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight === 0) return null
  let random = Math.random() * totalWeight
  for (const item of items) {
    random -= item.weight
    if (random <= 0) return item
  }
  return items[items.length - 1] ?? null
}

type ResourceArea = 'forest' | 'hills' | 'riverbank' | 'ruins'

async function completeExplore(agentId: string, area: Area): Promise<ActionCompletionResult> {
  // Commons has no resources
  if (area === 'commons') {
    return { type: 'explore', success: true, result: { discovered: 0, area } }
  }

  // Get spawn table for this area
  const table = await spawnTables.getSpawnTableForArea(area as ResourceArea)
  if (table.length === 0) {
    return { type: 'explore', success: true, result: { discovered: 0, area } }
  }

  // Roll for 1-3 new spawns
  const numSpawns = 1 + Math.floor(Math.random() * 3)
  const newSpawns = []

  for (let i = 0; i < numSpawns; i++) {
    const roll = weightedRandom(table)
    if (!roll) continue

    const richness = (roll.minRichness ?? 1) + Math.floor(Math.random() * ((roll.maxRichness ?? 5) - (roll.minRichness ?? 1) + 1))
    const spawn = {
      id: crypto.randomUUID().slice(0, 12),
      itemId: roll.itemId,
      area: area as ResourceArea,
      x: Math.floor(Math.random() * 100),
      y: Math.floor(Math.random() * 100),
      richness,
    }

    await spawns.createSpawn(spawn)
    newSpawns.push(spawn)
  }

  // Agent discovers one of them
  if (newSpawns.length > 0) {
    await spawns.discoverSpawn(newSpawns[0].id, agentId)
  }

  // Record discovery event
  await events.recordEvent('spawn', agentId, {
    area,
    count: newSpawns.length,
    discovered: newSpawns[0]?.id,
  })

  return {
    type: 'explore',
    success: true,
    result: {
      discovered: newSpawns.length,
      spawn: newSpawns[0] ? { id: newSpawns[0].id, item: newSpawns[0].itemId, richness: newSpawns[0].richness } : null,
    },
  }
}

async function completeHarvest(agentId: string, spawnId: string): Promise<ActionCompletionResult> {
  if (!spawnId) {
    return { type: 'harvest', success: false, error: 'No spawn ID' }
  }

  const spawn = await spawns.getSpawn(spawnId)
  if (!spawn) {
    return { type: 'harvest', success: false, error: 'Spawn not found' }
  }
  if (spawn.depletedAt) {
    return { type: 'harvest', success: false, error: 'Spawn depleted' }
  }

  // Add 1 item to inventory
  await inventory.addToInventory(agentId, spawn.itemId, 1)

  // Reduce richness
  const newRichness = spawn.richness - 1
  if (newRichness <= 0) {
    await spawns.depleteSpawn(spawnId)
    await events.recordEvent('deplete', agentId, { spawnId, itemId: spawn.itemId })
  } else {
    await spawns.updateSpawnRichness(spawnId, newRichness)
  }

  // Get item name for result
  const item = await items.getItem(spawn.itemId)

  return {
    type: 'harvest',
    success: true,
    result: {
      item: item?.name ?? spawn.itemId,
      itemId: spawn.itemId,
      quantity: 1,
      spawnDepleted: newRichness <= 0,
      remainingRichness: Math.max(0, newRichness),
    },
  }
}

async function completeCraft(agentId: string, recipeId: string): Promise<ActionCompletionResult> {
  // TODO: Implement crafting
  return { type: 'craft', success: true, result: { crafted: recipeId } }
}
