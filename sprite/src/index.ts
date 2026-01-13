import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'

const app = new Hono()
const anthropic = new Anthropic()

type Area = 'forest' | 'hills' | 'riverbank' | 'ruins' | 'commons'

interface TurnRequest {
  agentId: string
  worldState: {
    agent: {
      id: string
      name: string
      area: Area
      status: string
      action: string
      turns: number
      gold: number
    }
    gameState: {
      agents: unknown[]
      day: number
      season: string
    }
  }
}

interface TurnResponse {
  thoughts: string
  action: {
    type: 'TRAVEL' | 'EXPLORE' | 'WAIT'
    area?: Area
  }
}

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'travel',
    description: 'Travel to a different area. Takes 1 turn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        area: {
          type: 'string',
          enum: ['forest', 'hills', 'riverbank', 'ruins', 'commons'],
          description: 'The area to travel to',
        },
      },
      required: ['area'],
    },
  },
  {
    name: 'explore',
    description: 'Explore your current area to find resources or discover things. Takes 2 turns.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'wait',
    description: 'Wait and observe. Takes 1 turn. Use when unsure what to do.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

// GET /status - Health check
app.get('/status', (c) => {
  return c.json({ ready: true, timestamp: new Date().toISOString() })
})

// POST /turn - Agent decision endpoint
app.post('/turn', async (c) => {
  const body = await c.req.json<TurnRequest>()
  const { agentId, worldState } = body
  const { agent, gameState } = worldState

  console.log(`[Sprite] Turn for agent: ${agentId}`)
  console.log(`[Sprite] Current area: ${agent.area}`)

  // Pick a random area to suggest visiting (not current area)
  const otherAreas = ['forest', 'hills', 'riverbank', 'ruins', 'commons'].filter(a => a !== agent.area)
  const suggestedArea = otherAreas[Math.floor(Math.random() * otherAreas.length)]

  // Build prompt for Claude
  const systemPrompt = `You are ${agent.name}, a person living in a small village. You make decisions about what to do next.

Current situation:
- You are in the ${agent.area}
- You have ${agent.turns} turns remaining
- You have ${agent.gold}g
- It is Day ${gameState.day} of ${gameState.season}

Areas you can visit:
- forest: Dense woods with herbs, mushrooms, and wood
- hills: Rocky terrain with ore, gems, and stone
- riverbank: Water's edge with fish and salvage
- ruins: Ancient structures with artifacts
- commons: Town center with trading post

You've heard rumors that the ${suggestedArea} has interesting things today. You're feeling restless and curious about what's out there. Maybe it's time to wander somewhere new?

Pick ONE action. Vary your choices - don't just explore the same place repeatedly.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'any' }, // Must use a tool
      messages: [
        {
          role: 'user',
          content: 'What do you want to do?',
        },
      ],
    })

    console.log(`[Sprite] Claude response:`, JSON.stringify(message.content, null, 2))

    // Extract thoughts and tool use
    let thoughts = ''
    let action: TurnResponse['action'] = { type: 'WAIT' }

    for (const block of message.content) {
      if (block.type === 'text') {
        thoughts = block.text
      } else if (block.type === 'tool_use') {
        const toolName = block.name
        const toolInput = block.input as Record<string, unknown>

        if (toolName === 'travel') {
          action = {
            type: 'TRAVEL',
            area: toolInput.area as Area,
          }
        } else if (toolName === 'explore') {
          action = { type: 'EXPLORE' }
        } else if (toolName === 'wait') {
          action = { type: 'WAIT' }
        }
      }
    }

    console.log(`[Sprite] Decision: ${action.type}${action.area ? ` to ${action.area}` : ''}`)

    const response: TurnResponse = { thoughts, action }
    return c.json(response)
  } catch (error) {
    console.error('[Sprite] Claude error:', error)

    // Fallback to wait on error
    return c.json({
      thoughts: 'Something feels off... I should wait.',
      action: { type: 'WAIT' },
    } satisfies TurnResponse)
  }
})

const port = 4001
console.log(`Agent sprite running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
