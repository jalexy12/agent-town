import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { agents, getGameState, type Area } from './state'

const app = new Hono()

// CORS for local development
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}))

// Event emitter for SSE broadcasts
type SSEMessage = { type: string; [key: string]: unknown }
const listeners = new Set<(msg: SSEMessage) => void>()

function broadcast(data: SSEMessage) {
  console.log(`[SSE] Broadcasting to ${listeners.size} clients:`, JSON.stringify(data))
  for (const listener of listeners) {
    listener(data)
  }
}

// GET /state - Initial game state
app.get('/state', (c) => {
  return c.json(getGameState())
})

// GET /events - SSE stream
app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    console.log(`[SSE] Client connected (${listeners.size + 1} total)`)

    // Queue for messages to send
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

    // Send initial connection event
    await stream.writeSSE({
      data: JSON.stringify({ type: 'connected' }),
    })

    try {
      // Keep connection open, send messages as they arrive
      while (true) {
        // Wait for a message or send heartbeat
        if (messageQueue.length === 0) {
          // Wait up to 15 seconds for a message, then send heartbeat
          await Promise.race([
            new Promise<void>((r) => { resolve = r }),
            stream.sleep(15000),
          ])
        }

        // Send all queued messages
        while (messageQueue.length > 0) {
          const msg = messageQueue.shift()!
          await stream.writeSSE({
            data: JSON.stringify(msg),
          })
        }

        // Send heartbeat comment to keep connection alive
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

// POST /debug/trigger/:agentId - Trigger agent decision
app.post('/debug/trigger/:agentId', async (c) => {
  const { agentId } = c.req.param()
  const agent = agents.get(agentId)

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404)
  }

  console.log(`[Control] Triggering agent: ${agentId}`)

  // Call sprite's /turn endpoint
  try {
    const spriteUrl = 'http://localhost:4001/turn'
    const response = await fetch(spriteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        worldState: {
          agent: { ...agent },
          gameState: getGameState(),
        },
      }),
    })

    if (!response.ok) {
      return c.json({ error: 'Sprite request failed' }, 502)
    }

    const result = await response.json() as {
      thoughts: string
      action: { type: string; area?: Area }
    }

    console.log(`[Control] Sprite response:`, result)

    // Execute action
    if (result.action.type === 'TRAVEL' && result.action.area) {
      const newArea = result.action.area
      agent.area = newArea
      agent.action = `Traveling to ${newArea}`
      agent.status = 'busy'

      broadcast({
        type: 'TRAVEL',
        agentId,
        area: newArea,
        thoughts: result.thoughts,
      })
    } else if (result.action.type === 'EXPLORE') {
      agent.action = `Exploring ${agent.area}`
      agent.status = 'busy'

      broadcast({
        type: 'EXPLORE',
        agentId,
        area: agent.area,
        thoughts: result.thoughts,
      })
    } else if (result.action.type === 'WAIT') {
      agent.action = 'Waiting'
      agent.status = 'idle'

      broadcast({
        type: 'WAIT',
        agentId,
        thoughts: result.thoughts,
      })
    }

    return c.json({
      success: true,
      action: result.action,
      thoughts: result.thoughts,
    })
  } catch (error) {
    console.error('[Control] Error calling sprite:', error)
    return c.json({ error: 'Failed to contact sprite' }, 502)
  }
})

const port = 4000
console.log(`Control plane running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 0,
}
