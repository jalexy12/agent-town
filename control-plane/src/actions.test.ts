import { describe, test, expect, mock, beforeEach } from 'bun:test'

// Test the weighted random helper directly
// Extracted here since it's not exported from actions.ts
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

describe('weightedRandom', () => {
  test('returns null for empty array', () => {
    expect(weightedRandom([])).toBe(null)
  })

  test('returns null when all weights are 0', () => {
    expect(weightedRandom([{ weight: 0 }, { weight: 0 }])).toBe(null)
  })

  test('always returns the only item', () => {
    const items = [{ id: 'only', weight: 100 }]
    for (let i = 0; i < 10; i++) {
      expect(weightedRandom(items)?.id).toBe('only')
    }
  })

  test('respects weights roughly (statistical)', () => {
    const items = [
      { id: 'common', weight: 90 },
      { id: 'rare', weight: 10 },
    ]

    const counts: Record<string, number> = { common: 0, rare: 0 }
    const iterations = 1000

    for (let i = 0; i < iterations; i++) {
      const result = weightedRandom(items)
      if (result) counts[result.id]++
    }

    // Common should be picked ~90% of the time (allow 5% tolerance)
    const commonRatio = counts.common / iterations
    expect(commonRatio).toBeGreaterThan(0.8)
    expect(commonRatio).toBeLessThan(0.98)
  })
})

// Mock the repositories before importing actions
const mockAgent = {
  id: 'alice',
  name: 'Alice',
  area: 'commons',
  gold: 100,
  turns: '5.00',
  status: 'idle',
  currentAction: null,
  actionData: null,
}

const mockListing = {
  id: 'listing-1',
  sellerId: 'bob',
  itemId: 'healroot',
  quantity: 5,
  priceEach: 10,
  soldAt: null,
}

const mockInventoryItem = { agentId: 'alice', itemId: 'healroot', quantity: 10 }

// Mock all repository modules
mock.module('./db/repositories', () => ({
  agents: {
    getAgent: mock(() => Promise.resolve({ ...mockAgent })),
    updateAgent: mock(() => Promise.resolve()),
    addGold: mock(() => Promise.resolve()),
    deductGold: mock(() => Promise.resolve()),
  },
  listings: {
    getActiveListings: mock(() => Promise.resolve([
      { ...mockListing, itemName: 'Healroot' },
    ])),
    getListing: mock(() => Promise.resolve({ ...mockListing })),
    createListing: mock(() => Promise.resolve()),
    completeSale: mock(() => Promise.resolve()),
  },
  inventory: {
    getInventoryItem: mock(() => Promise.resolve({ ...mockInventoryItem })),
    addToInventory: mock(() => Promise.resolve()),
    removeFromInventory: mock(() => Promise.resolve()),
  },
  messages: {
    sendMessage: mock(() => Promise.resolve()),
  },
  events: {
    recordEvent: mock(() => Promise.resolve()),
  },
  spawns: {
    createSpawn: mock(() => Promise.resolve()),
    discoverSpawn: mock(() => Promise.resolve()),
    getSpawn: mock(() => Promise.resolve({ id: 'spawn-1', itemId: 'healroot', richness: 3, depletedAt: null })),
    updateSpawnRichness: mock(() => Promise.resolve()),
    depleteSpawn: mock(() => Promise.resolve()),
  },
  spawnTables: {
    getSpawnTableForArea: mock(() => Promise.resolve([
      { itemId: 'healroot', weight: 100, minRichness: 1, maxRichness: 5 },
    ])),
  },
  items: {
    getItem: mock(() => Promise.resolve({ id: 'healroot', name: 'Healroot' })),
  },
}))

// Import after mocking
import { executeAction, completeAction } from './actions'
import { agents, listings, inventory } from './db/repositories'

describe('Trading Actions', () => {
  beforeEach(() => {
    // Reset mocks to default behavior
    ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ ...mockAgent })
    )
    ;(listings.getListing as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ ...mockListing })
    )
    ;(inventory.getInventoryItem as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ ...mockInventoryItem })
    )
  })

  describe('view_listings', () => {
    test('fails when not in commons', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, area: 'forest' })
      )

      const result = await executeAction('alice', { name: 'view_listings', input: {} })

      expect(result.success).toBe(false)
      expect(result.error).toContain('commons')
    })

    test('succeeds when in commons', async () => {
      const result = await executeAction('alice', { name: 'view_listings', input: {} })

      expect(result.success).toBe(true)
      expect(result.result).toHaveProperty('listings')
    })
  })

  describe('list_item', () => {
    test('fails when not in commons', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, area: 'forest' })
      )

      const result = await executeAction('alice', {
        name: 'list_item',
        input: { item_id: 'healroot', quantity: 5, price_each: 10 },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('commons')
    })

    test('fails when not enough inventory', async () => {
      ;(inventory.getInventoryItem as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ agentId: 'alice', itemId: 'healroot', quantity: 2 })
      )

      const result = await executeAction('alice', {
        name: 'list_item',
        input: { item_id: 'healroot', quantity: 5, price_each: 10 },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Not enough')
    })

    test('fails when item not in inventory', async () => {
      ;(inventory.getInventoryItem as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(null)
      )

      const result = await executeAction('alice', {
        name: 'list_item',
        input: { item_id: 'healroot', quantity: 5, price_each: 10 },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Not enough')
    })

    test('removes items and creates listing on success', async () => {
      const result = await executeAction('alice', {
        name: 'list_item',
        input: { item_id: 'healroot', quantity: 5, price_each: 10 },
      })

      expect(result.success).toBe(true)
      expect(inventory.removeFromInventory).toHaveBeenCalledWith('alice', 'healroot', 5)
      expect(listings.createListing).toHaveBeenCalled()
    })
  })

  describe('buy_listing', () => {
    test('fails when not in commons', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, area: 'hills' })
      )

      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'listing-1' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('commons')
    })

    test('fails when listing not found', async () => {
      ;(listings.getListing as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(null)
      )

      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'nonexistent' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    test('fails when listing already sold', async () => {
      ;(listings.getListing as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockListing, soldAt: new Date() })
      )

      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'listing-1' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('already sold')
    })

    test('fails when buying own listing', async () => {
      ;(listings.getListing as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockListing, sellerId: 'alice' })
      )

      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'listing-1' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('own listing')
    })

    test('fails when not enough gold', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, gold: 10 }) // 10 gold, but listing costs 50
      )

      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'listing-1' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Not enough gold')
    })

    test('transfers gold and items on success', async () => {
      const result = await executeAction('alice', {
        name: 'buy_listing',
        input: { listing_id: 'listing-1' },
      })

      expect(result.success).toBe(true)
      // 5 items * 10 gold = 50 total
      expect(agents.deductGold).toHaveBeenCalledWith('alice', 50)
      expect(agents.addGold).toHaveBeenCalledWith('bob', 50)
      expect(inventory.addToInventory).toHaveBeenCalledWith('alice', 'healroot', 5)
      expect(listings.completeSale).toHaveBeenCalledWith('listing-1', 'alice')
    })
  })
})

describe('Core Actions', () => {
  beforeEach(() => {
    ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ ...mockAgent })
    )
    ;(agents.updateAgent as ReturnType<typeof mock>).mockClear()
  })

  describe('travel', () => {
    test('updates agent area', async () => {
      const result = await executeAction('alice', {
        name: 'travel',
        input: { area: 'forest' },
      })

      expect(result.success).toBe(true)
      expect(agents.updateAgent).toHaveBeenCalledWith('alice', expect.objectContaining({
        area: 'forest',
        status: 'busy',
      }))
    })
  })

  describe('harvest', () => {
    test('stores spawnId in actionData for completion', async () => {
      const result = await executeAction('alice', {
        name: 'harvest',
        input: { spawn_id: 'spawn-123' },
      })

      expect(result.success).toBe(true)
      expect(agents.updateAgent).toHaveBeenCalledWith('alice', expect.objectContaining({
        actionData: { spawnId: 'spawn-123' },
        status: 'busy',
      }))
    })
  })

  describe('craft', () => {
    test('stores recipeId in actionData for completion', async () => {
      const result = await executeAction('alice', {
        name: 'craft',
        input: { recipe_id: 'recipe-456' },
      })

      expect(result.success).toBe(true)
      expect(agents.updateAgent).toHaveBeenCalledWith('alice', expect.objectContaining({
        actionData: { recipeId: 'recipe-456' },
        status: 'busy',
      }))
    })
  })

  describe('sleep', () => {
    test('sets sleeping status without completion time', async () => {
      const result = await executeAction('alice', {
        name: 'sleep',
        input: {},
      })

      expect(result.success).toBe(true)
      expect(result.duration).toBe(0)
      expect(agents.updateAgent).toHaveBeenCalledWith('alice', expect.objectContaining({
        status: 'sleeping',
        actionCompletesAt: null,
      }))
    })
  })

  describe('send_message', () => {
    test('sends message to recipient', async () => {
      const { messages } = await import('./db/repositories')

      const result = await executeAction('alice', {
        name: 'send_message',
        input: { to: 'bob', content: 'Hello Bob!' },
      })

      expect(result.success).toBe(true)
      expect(result.duration).toBe(0)
      expect(messages.sendMessage).toHaveBeenCalledWith('alice', 'bob', 'Hello Bob!')
    })
  })

  describe('unknown action', () => {
    test('returns error for unknown action', async () => {
      const result = await executeAction('alice', {
        name: 'nonexistent_action',
        input: {},
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown action')
    })
  })
})

describe('Action Completion', () => {
  beforeEach(() => {
    ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ ...mockAgent, area: 'forest', currentAction: 'Exploring forest' })
    )
  })

  describe('completeExplore', () => {
    test('returns empty result for commons', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, area: 'commons', currentAction: 'Exploring commons' })
      )

      const result = await completeAction('alice')

      expect(result.type).toBe('explore')
      expect(result.success).toBe(true)
      expect((result.result as any).discovered).toBe(0)
    })

    test('creates spawns for resource areas', async () => {
      const { spawns } = await import('./db/repositories')

      const result = await completeAction('alice')

      expect(result.type).toBe('explore')
      expect(result.success).toBe(true)
      expect((result.result as any).discovered).toBeGreaterThanOrEqual(1)
      expect(spawns.createSpawn).toHaveBeenCalled()
      expect(spawns.discoverSpawn).toHaveBeenCalled()
    })
  })

  describe('completeHarvest', () => {
    test('fails without spawnId', async () => {
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, currentAction: 'Harvesting', actionData: null })
      )

      const result = await completeAction('alice')

      expect(result.type).toBe('harvest')
      expect(result.success).toBe(false)
      expect(result.error).toContain('No spawn ID')
    })

    test('fails when spawn not found', async () => {
      const { spawns } = await import('./db/repositories')
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, currentAction: 'Harvesting', actionData: { spawnId: 'bad-id' } })
      )
      ;(spawns.getSpawn as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(null))

      const result = await completeAction('alice')

      expect(result.type).toBe('harvest')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    test('fails when spawn depleted', async () => {
      const { spawns } = await import('./db/repositories')
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, currentAction: 'Harvesting', actionData: { spawnId: 'spawn-1' } })
      )
      ;(spawns.getSpawn as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ id: 'spawn-1', itemId: 'healroot', richness: 0, depletedAt: new Date() })
      )

      const result = await completeAction('alice')

      expect(result.type).toBe('harvest')
      expect(result.success).toBe(false)
      expect(result.error).toContain('depleted')
    })

    test('adds to inventory and reduces richness on success', async () => {
      const { spawns } = await import('./db/repositories')
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, currentAction: 'Harvesting', actionData: { spawnId: 'spawn-1' } })
      )
      ;(spawns.getSpawn as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ id: 'spawn-1', itemId: 'healroot', richness: 3, depletedAt: null })
      )

      const result = await completeAction('alice')

      expect(result.type).toBe('harvest')
      expect(result.success).toBe(true)
      expect(inventory.addToInventory).toHaveBeenCalledWith('alice', 'healroot', 1)
      expect(spawns.updateSpawnRichness).toHaveBeenCalledWith('spawn-1', 2)
    })

    test('depletes spawn when richness reaches 0', async () => {
      const { spawns } = await import('./db/repositories')
      ;(agents.getAgent as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ ...mockAgent, currentAction: 'Harvesting', actionData: { spawnId: 'spawn-1' } })
      )
      ;(spawns.getSpawn as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ id: 'spawn-1', itemId: 'healroot', richness: 1, depletedAt: null })
      )

      const result = await completeAction('alice')

      expect(result.success).toBe(true)
      expect((result.result as any).spawnDepleted).toBe(true)
      expect(spawns.depleteSpawn).toHaveBeenCalledWith('spawn-1')
    })
  })
})
