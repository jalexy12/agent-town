import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { SpritesClient } from '@fly/sprites'
import pRetry from 'p-retry'
import { getGameState, getAgent, getAgentsByArea, type Area } from './state'
import { agents, inventory, skills, spawns, listings, messages, events, world, sessions } from './db/repositories'
import { startScheduler } from './scheduler'
import { executeAction } from './actions'

// Sprites client for waking sprites
const spritesClient = process.env.SPRITES_TOKEN
  ? new SpritesClient(process.env.SPRITES_TOKEN)
  : null

// Expected code version - must match sprite/src/index.ts CODE_VERSION
const EXPECTED_CODE_VERSION = '2026-01-16-v9'

// Wake a sprite and ensure server is running with correct code version
export async function wakeSprite(agentId: string): Promise<void> {
  if (!spritesClient) return // Skip if no token (local dev)

  const spriteName = `agent-town-${agentId}`
  try {
    const sprite = await spritesClient.getSprite(spriteName)

    // Wake sprite from checkpoint
    await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

    // Check if server is running and has correct version
    const check = await sprite.execFile('bash', ['-c', 'curl -s http://localhost:8080/status || echo "not_running"'])
    const needsRestart = check.stdout.includes('not_running') ||
                         check.stdout.includes('refused') ||
                         !check.stdout.includes(EXPECTED_CODE_VERSION)

    if (needsRestart) {
      console.log(`[Control] Server on ${spriteName} needs restart (status: ${check.stdout.slice(0, 100)})`)

      // Kill old server - use pkill (lsof not installed on sprites)
      try {
        await sprite.execFile('bash', ['-c', 'pkill -9 bun || true; sleep 2'])
      } catch { /* expected */ }

      // Start new server
      await pRetry(async () => {
        await sprite.execFile('bash', ['-c', 'nohup /app/start.sh > /app/server.log 2>&1 &'])
      }, { retries: 3, minTimeout: 500 })

      // Wait for server to be ready - sprites.dev needs time to route
      await new Promise(r => setTimeout(r, 5000))

      // Verify new server is up
      for (let i = 0; i < 3; i++) {
        const verify = await sprite.execFile('bash', ['-c', 'curl -s http://localhost:8080/status || echo "not_ready"'])
        if (verify.stdout.includes(EXPECTED_CODE_VERSION)) {
          console.log(`[Control] Server on ${spriteName} ready with correct version`)
          break
        }
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  } catch (error) {
    console.warn(`[Control] Failed to wake sprite ${spriteName}:`, error)
  }
}

const app = new Hono()

// CORS
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'https://ui-delta-vert.vercel.app'],
  credentials: true,
}))

// Admin endpoints for sprite updates (pause state stored in DB for durability)
app.post('/admin/pause', async (c) => {
  await world.setSchedulerPaused(true)
  console.log('[Admin] Scheduler PAUSED for sprite update')
  return c.json({ paused: true, message: 'Scheduler paused' })
})

app.post('/admin/resume', async (c) => {
  await world.setSchedulerPaused(false)
  console.log('[Admin] Scheduler RESUMED')
  return c.json({ paused: false, message: 'Scheduler resumed' })
})

app.get('/admin/status', async (c) => {
  const paused = await world.isSchedulerPaused()
  return c.json({ schedulerPaused: paused, expectedVersion: EXPECTED_CODE_VERSION })
})

// Event emitter for SSE broadcasts
type SSEMessage = { type: string; [key: string]: unknown }
const listeners = new Set<(msg: SSEMessage) => void>()

export function broadcast(data: SSEMessage) {
  console.log(`[SSE] Broadcasting to ${listeners.size} clients:`, JSON.stringify(data))
  for (const listener of listeners) {
    listener(data)
  }
}

// GET /state - Initial game state
app.get('/state', async (c) => {
  const state = await getGameState()
  return c.json(state)
})

// GET /events - SSE stream
app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    console.log(`[SSE] Client connected (${listeners.size + 1} total)`)

    const messageQueue: SSEMessage[] = []
    let resolve: (() => void) | null = null

    const listener = (msg: SSEMessage) => {
      messageQueue.push(msg)
      if (resolve) {
        resolve()
        resolve = null
      }
    }

    listeners.add(listener)

    await stream.writeSSE({
      data: JSON.stringify({ type: 'connected' }),
    })

    try {
      while (true) {
        if (messageQueue.length === 0) {
          await Promise.race([
            new Promise<void>((r) => { resolve = r }),
            stream.sleep(15000),
          ])
        }

        while (messageQueue.length > 0) {
          const msg = messageQueue.shift()!
          await stream.writeSSE({
            data: JSON.stringify(msg),
          })
        }

        await stream.writeSSE({
          data: '',
          event: 'heartbeat',
        })
      }
    } finally {
      listeners.delete(listener)
      console.log(`[SSE] Client disconnected (${listeners.size} remaining)`)
    }
  })
})

// Build world state for sprite - now fully async with real DB queries
export async function buildWorldState(agentId: string) {
  const agent = await getAgent(agentId)
  if (!agent) throw new Error('Agent not found')

  const [
    agentInventory,
    agentSkills,
    areaSpawns,
    unreadMessages,
    otherAgents,
    worldState,
  ] = await Promise.all([
    inventory.getAgentInventory(agentId),
    skills.getAgentSkills(agentId),
    spawns.getActiveSpawnsInArea(agent.area as Exclude<Area, 'commons'>),
    messages.getUnreadMessages(agentId),
    getAgentsByArea(agent.area),
    world.getAll(),
  ])

  return {
    self: {
      area: agent.area,
      gold: agent.gold,
      turns: agent.turns,
      inventory: agentInventory.map(i => ({ id: i.itemId, name: i.name, quantity: i.quantity })),
      skills: agentSkills.map(s => ({ skill: s.skill, level: s.level })),
    },
    time: {
      day: worldState.day?.valueInt ?? 1,
      season: worldState.season?.valueText ?? 'spring',
      timeOfDay: worldState.time_of_day?.valueText ?? 'day',
    },
    area: {
      spawns: areaSpawns.map(s => ({ id: s.id, item: s.itemName, richness: s.richness })),
      agents: otherAgents.filter(a => a.id !== agentId).map(a => ({ id: a.id, name: a.name })),
    },
    unreadMessages: unreadMessages.map(m => ({
      from: m.fromId,
      content: m.content,
      at: m.createdAt?.toString() ?? new Date().toISOString(),
    })),
  }
}

// Track last results per agent
const lastResults = new Map<string, unknown>()

// POST /debug/trigger/:agentId - Trigger agent decision (manual, for testing)
app.post('/debug/trigger/:agentId', async (c) => {
  const { agentId } = c.req.param()
  const agentRow = await agents.getAgent(agentId)

  if (!agentRow) {
    return c.json({ error: 'Agent not found' }, 404)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`[Control] TRIGGER START: ${agentId}`)
  console.log(`[Control] Sprite URL: ${agentRow.spriteUrl}`)
  console.log(`${'='.repeat(60)}`)

  try {
    // Wake the sprite first (resumes from checkpoint)
    console.log(`[Control] Step 1: Waking sprite...`)
    const wakeStart = Date.now()
    await wakeSprite(agentId)
    console.log(`[Control] Step 1: Wake complete (${Date.now() - wakeStart}ms)`)

    const spriteUrl = `${agentRow.spriteUrl}/turn`
    console.log(`[Control] Step 2: Building world state...`)
    const worldState = await buildWorldState(agentId)
    console.log(`[Control] Step 2: World state built - area=${worldState.self.area}, turns=${worldState.self.turns}`)

    const lastResult = lastResults.get(agentId) ?? null
    const requestBody = {
      agentId,
      result: lastResult,
      world: worldState,
    }

    console.log(`[Control] Step 3: Calling sprite at ${spriteUrl}`)
    const fetchStart = Date.now()

    // Retry on 502/503 (sprite not ready yet)
    const response = await pRetry(async () => {
      const res = await fetch(spriteUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      if (res.status === 502 || res.status === 503) {
        throw new Error(`Sprite returned ${res.status}`)
      }
      return res
    }, { retries: 3, minTimeout: 2000 })

    console.log(`[Control] Step 3: Response received (${Date.now() - fetchStart}ms)`)
    console.log(`[Control] Response status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Control] ERROR: Sprite returned ${response.status}`)
      console.error(`[Control] ERROR body: ${errorText}`)
      return c.json({ error: 'Sprite request failed', status: response.status, body: errorText }, 502)
    }

    // Claude's Message response
    const message = await response.json() as {
      content: Array<
        | { type: 'thinking'; thinking: string }
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }

    console.log(`[Control] Sprite response:`, JSON.stringify(message, null, 2))

    // Execute tool calls using the shared action executor
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue
      await executeAction(agentId, { name: block.name, input: block.input })
    }

    // Record the turn event with full message content
    await events.recordEvent('turn', agentId, { message })

    // Broadcast and return the raw message
    broadcast({ type: 'TURN', agentId, message })
    broadcast({ type: 'AGENT_UPDATE', agent: await agents.getAgent(agentId) })
    lastResults.set(agentId, message)

    return c.json(message)
  } catch (error) {
    console.error('[Control] Error calling sprite:', error)
    return c.json({ error: 'Failed to contact sprite' }, 502)
  }
})

// GET /events/history - All events for activity log
app.get('/events/history', async (c) => {
  const recentEvents = await events.getRecentEvents()

  // Transform to match UI's ActivityEvent format
  const activityEvents = await Promise.all(
    recentEvents
      .filter(e => e.type === 'turn')
      .map(async (e) => {
        const agent = await getAgent(e.agentId!)
        const data = e.data as { message?: { content: unknown[] } }
        return {
          id: e.id,
          time: e.createdAt ? new Date(e.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
          agent: agent?.name ?? e.agentId ?? 'Unknown',
          message: data.message ?? { content: [] },
        }
      })
  )

  return c.json(activityEvents)
})

// POST /execute - Execute an action for a sprite (called by sprites during agentic loop)
app.post('/execute', async (c) => {
  const body = await c.req.json<{
    agentId: string
    action: { name: string; input: Record<string, unknown> }
  }>()

  const { agentId, action } = body

  console.log(`[Execute] Agent ${agentId} executing: ${action.name}`)

  // Execute the action
  const result = await executeAction(agentId, action)

  // Deduct turn on success
  if (result.success) {
    const { deductTurn } = await import('./db/repositories/agents')
    await deductTurn(agentId)
  }

  console.log(`[Execute] Result:`, result)

  // Broadcast to UI
  broadcast({ type: 'ACTION', agentId, action: action.name, result })
  broadcast({ type: 'AGENT_UPDATE', agent: await agents.getAgent(agentId) })

  return c.json(result)
})

// GET /world/:agentId - Get current world state for an agent (called by sprites)
app.get('/world/:agentId', async (c) => {
  const { agentId } = c.req.param()
  const worldState = await buildWorldState(agentId)
  return c.json(worldState)
})

// GET /session/:agentId - Get session state for an agent (called by sprites)
app.get('/session/:agentId', async (c) => {
  const { agentId } = c.req.param()
  const session = await sessions.getSession(agentId)
  return c.json(session)
})

// POST /session/:agentId - Save session state for an agent (called by sprites)
app.post('/session/:agentId', async (c) => {
  const { agentId } = c.req.param()
  const session = await c.req.json()
  await sessions.saveSession(agentId, session)
  return c.json({ saved: true })
})

// DELETE /session/:agentId - Clear session for an agent (called by sprites)
app.delete('/session/:agentId', async (c) => {
  const { agentId } = c.req.param()
  await sessions.clearSession(agentId)
  return c.json({ cleared: true })
})

// GET /health - Health check with DB connectivity test
app.get('/health', async (c) => {
  try {
    const state = await world.getAll()
    return c.json({ status: 'ok', db: 'connected', day: state.day?.valueInt })
  } catch (e) {
    return c.json({ status: 'error', db: 'disconnected', error: String(e) }, 500)
  }
})

const port = Number(process.env.PORT) || 4000
console.log(`Control plane running on http://localhost:${port}`)

// Start the game scheduler
startScheduler({ broadcast, buildWorldState, wakeSprite, isSchedulerPaused: world.isSchedulerPaused })

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 0,
}
