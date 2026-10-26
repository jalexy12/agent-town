import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { readdir, mkdir, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = new Hono()
const anthropic = new Anthropic()

// Control plane URL for executing actions
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'https://agent-town-control.fly.dev'

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BASE_DIR = resolve(__dirname, '..')

// Paths (relative to sprite directory, not cwd)
const CONFIG_PATH = resolve(BASE_DIR, 'config/agent.json')
const DIARY_PATH = resolve(BASE_DIR, 'state/diary.md')
const TURNS_DIR = resolve(BASE_DIR, 'state/turns')
const LOG_PATH = resolve(BASE_DIR, 'state/sprite.log')
const MEMORY_DIR = resolve(BASE_DIR, 'state/memory')

// Memory system: sandboxed bash execution
const ALLOWED_COMMANDS = ['ls', 'cat', 'head', 'tail', 'echo', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'grep', 'find', 'wc']
const BASH_TIMEOUT_MS = 5000

async function executeBash(command: string): Promise<string> {
  // Ensure memory directory exists
  await mkdir(MEMORY_DIR, { recursive: true })

  // Validate command - check first word
  const firstWord = command.trim().split(/\s+/)[0]
  if (!ALLOWED_COMMANDS.includes(firstWord)) {
    return `Error: Command '${firstWord}' not allowed. Use: ${ALLOWED_COMMANDS.join(', ')}`
  }

  // Check for dangerous patterns
  // Block: .. (path traversal), backticks, $() (command substitution), ; (chaining)
  if (/\.\.|`|\$\(|;/.test(command)) {
    return 'Error: Command contains disallowed characters (no .., backticks, $(), or ;)'
  }

  try {
    // Use Bun's built-in shell with raw for dynamic command
    const result = await Promise.race([
      Bun.$`cd ${MEMORY_DIR} && ${{ raw: command }}`.quiet().nothrow(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command timed out')), BASH_TIMEOUT_MS)
      ),
    ])

    if (result.exitCode !== 0) {
      return `Error (exit ${result.exitCode}): ${result.stderr.toString() || result.stdout.toString()}`
    }

    return result.stdout.toString() || '(no output)'
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Game actions that get returned to control plane (vs bash which executes locally)
const GAME_ACTIONS = new Set([
  'explore', 'harvest', 'travel', 'craft',
  'list_item', 'buy_listing', 'view_listings',
  'send_message', 'sleep', 'wait'
])

const MAX_ITERATIONS = 50

// File-based logger that persists across checkpoint restores
async function log(level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN', message: string, data?: unknown) {
  const timestamp = new Date().toISOString()
  let line = `[${timestamp}] [${level}] ${message}`
  if (data !== undefined) {
    line += ` | ${JSON.stringify(data)}`
  }
  line += '\n'

  // Write to file (persists) and console (immediate visibility)
  console.log(line.trim())
  try {
    await appendFile(LOG_PATH, line)
  } catch {
    // If state dir doesn't exist yet, try creating it
    try {
      await mkdir('./state', { recursive: true })
      await appendFile(LOG_PATH, line)
    } catch {
      // Ignore if we still can't write
    }
  }
}

// Types
type Area = 'forest' | 'hills' | 'riverbank' | 'ruins' | 'commons'

interface AgentConfig {
  name: string
  personality: string
  goals: string
}

// A turn stores the complete Claude API conversation
// messages: all accumulated messages (user prompts, assistant responses, tool results)
interface TurnRecord {
  turnId: number
  at: string
  messages: Array<Anthropic.Messages.MessageParam>
}

interface WorldState {
  self: {
    area: Area
    gold: number
    turns: number
    inventory: Array<{ id: string; name: string; quantity: number }>
    skills: Array<{ skill: string; level: string }>
  }
  time: {
    day: number
    season: string
    timeOfDay: string
  }
  area: {
    spawns: Array<{ id: string; item: string; richness: number }>
    agents: Array<{ id: string; name: string }>
  }
  unreadMessages: Array<{ from: string; content: string; at: string }>
}

interface TurnRequest {
  agentId: string
  result: unknown
  world: WorldState
}

// Session: persistent conversation across multiple /turn calls
// Session state is stored in the control plane DB, NOT on the sprite filesystem
interface Session {
  sessionId: string
  messages: Anthropic.Messages.MessageParam[]
  startedAt: string
  actionCount: number
  pendingToolUseId: string | null  // ID of game action awaiting result
}

// Load session from control plane DB
async function loadSession(agentId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${CONTROL_PLANE_URL}/session/${agentId}`)
    if (!response.ok) return null
    const session = await response.json()
    return session // Returns null if no session exists
  } catch (error) {
    await log('WARN', 'Failed to load session from control plane', { error: String(error) })
    return null
  }
}

// Save session to control plane DB
async function saveSession(agentId: string, session: Session): Promise<void> {
  try {
    await fetch(`${CONTROL_PLANE_URL}/session/${agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    })
  } catch (error) {
    await log('ERROR', 'Failed to save session to control plane', { error: String(error) })
  }
}

// Clear session in control plane DB (on sleep or offline)
async function clearSession(agentId: string): Promise<void> {
  try {
    await fetch(`${CONTROL_PLANE_URL}/session/${agentId}`, {
      method: 'DELETE',
    })
  } catch (error) {
    await log('WARN', 'Failed to clear session in control plane', { error: String(error) })
  }
}

// Execute action via control plane
interface ActionResult {
  success: boolean
  duration: number
  result?: unknown
  error?: string
}

async function executeGameAction(agentId: string, action: { name: string; input: unknown }): Promise<ActionResult> {
  const response = await fetch(`${CONTROL_PLANE_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, action }),
  })

  if (!response.ok) {
    const text = await response.text()
    return { success: false, duration: 0, error: `Control plane error: ${response.status} ${text}` }
  }

  return response.json()
}

// Fetch fresh world state from control plane
async function fetchWorldState(agentId: string): Promise<WorldState> {
  const response = await fetch(`${CONTROL_PLANE_URL}/world/${agentId}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch world state: ${response.status}`)
  }
  return response.json()
}

// Tool definitions
const tools: Anthropic.Tool[] = [
  {
    name: 'explore',
    description: 'Explore your current area to discover resource spawns. Costs 2 turns, takes ~30 min.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'harvest',
    description: 'Harvest from a visible spawn in your area. Costs 1-2 turns based on richness.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spawn_id: { type: 'string', description: 'ID of the spawn to harvest' },
      },
      required: ['spawn_id'],
    },
  },
  {
    name: 'travel',
    description: 'Travel to a different area. Costs 1 turn, takes ~15 min.',
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
    name: 'craft',
    description: 'Craft an item using a known recipe. Costs 1-3 turns based on complexity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipe_id: { type: 'string', description: 'ID of the recipe to craft' },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: 'list_item',
    description: 'List an item for sale at the trading post.',
    input_schema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'ID of the item to sell' },
        quantity: { type: 'number', description: 'How many to list' },
        price_each: { type: 'number', description: 'Price per unit in gold' },
      },
      required: ['item_id', 'quantity', 'price_each'],
    },
  },
  {
    name: 'buy_listing',
    description: 'Buy an item from the trading post.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string', description: 'ID of the listing to buy' },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'view_listings',
    description: 'View all items currently for sale at the trading post. Returns list of listings with seller, item, quantity, and price.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to another agent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'ID of the agent to message' },
        content: { type: 'string', description: 'The message content' },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: 'sleep',
    description: 'Go to sleep for faster turn regeneration. You will wake when turns are full.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'wait',
    description: 'Do nothing this turn. Use when no good options available.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'bash',
    description: `Execute a bash command to manage your memory files.

You start in your memory directory. All paths are relative to it.

Commands: ls, cat, head, tail, echo, mkdir, rm, mv, cp, touch, grep, find, wc

Examples:
  ls                                         # List your files
  cat journal.md                             # Read a file
  cat journal.md 2>/dev/null || echo "none"  # Read with fallback
  echo "Day 5: Found herbs" >> journal.md    # Append to file
  mkdir -p people                            # Create subdirectory

Use memory to track knowledge that helps you make better decisions.
Memory persists across all your turns - use it to build long-term knowledge.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
]

// Load agent config (read-only)
async function loadConfig(): Promise<AgentConfig> {
  const file = Bun.file(CONFIG_PATH)
  if (!(await file.exists())) {
    throw new Error('Agent config not found')
  }
  return file.json()
}

// Load diary
async function loadDiary(): Promise<string> {
  const file = Bun.file(DIARY_PATH)
  if (!(await file.exists())) {
    return ''
  }
  return file.text()
}

// Load recent turns
async function loadRecentTurns(limit = 10): Promise<TurnRecord[]> {
  try {
    const files = await readdir(TURNS_DIR)
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit)

    const turns: TurnRecord[] = []
    for (const f of jsonFiles) {
      const turn = await Bun.file(`${TURNS_DIR}/${f}`).json()
      turns.push(turn)
    }
    return turns.reverse() // chronological order
  } catch {
    return []
  }
}

// Get next turn ID
async function getNextTurnId(): Promise<number> {
  try {
    const files = await readdir(TURNS_DIR)
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    if (jsonFiles.length === 0) return 1

    const ids = jsonFiles.map(f => parseInt(f.replace('.json', ''), 10))
    return Math.max(...ids) + 1
  } catch {
    return 1
  }
}

// Save turn record
async function saveTurn(turn: TurnRecord): Promise<void> {
  await mkdir(TURNS_DIR, { recursive: true })
  const filename = `${TURNS_DIR}/${String(turn.turnId).padStart(4, '0')}.json`
  await Bun.write(filename, JSON.stringify(turn, null, 2))
}

// Append to diary
async function appendDiary(entry: string): Promise<void> {
  const existing = await loadDiary()
  const newContent = existing ? `${existing}\n\n---\n\n${entry}` : entry
  await Bun.write(DIARY_PATH, newContent)
}

// Build system prompt
function buildSystemPrompt(config: AgentConfig, world: WorldState, diary: string, recentTurns: TurnRecord[]): string {
  const inventoryStr = world.self.inventory.length > 0
    ? world.self.inventory.map(i => `  - ${i.name} x${i.quantity}`).join('\n')
    : '  (empty)'

  const skillsStr = world.self.skills.length > 0
    ? world.self.skills.map(s => `  - ${s.skill}: ${s.level}`).join('\n')
    : '  (none)'

  const spawnsStr = world.area.spawns.length > 0
    ? world.area.spawns.map(s => `  - ${s.item} (richness: ${s.richness}) [id: ${s.id}]`).join('\n')
    : '  (none visible)'

  const agentsStr = world.area.agents.length > 0
    ? world.area.agents.map(a => `  - ${a.name}`).join('\n')
    : '  (nobody else here)'

  const messagesStr = world.unreadMessages.length > 0
    ? world.unreadMessages.map(m => `  From ${m.from}: "${m.content}"`).join('\n')
    : '  (no new messages)'

  // Extract actions from turn messages
  const recentActionsStr = recentTurns.length > 0
    ? recentTurns.slice(-5).map(t => {
        // Handle both old format (action/params) and new format (messages array)
        const turnAny = t as unknown as Record<string, unknown>

        // Old format
        if (turnAny.action && typeof turnAny.action === 'string') {
          const params = turnAny.params as Record<string, unknown> | undefined
          return `  - ${turnAny.action}${params && Object.keys(params).length > 0 ? ` (${JSON.stringify(params)})` : ''}`
        }

        // New format - find tool_use blocks in assistant messages
        if (t.messages) {
          for (const msg of t.messages) {
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (typeof block === 'object' && 'type' in block && block.type === 'tool_use') {
                  const toolBlock = block as { name: string; input: unknown }
                  return `  - ${toolBlock.name}${toolBlock.input ? ` (${JSON.stringify(toolBlock.input)})` : ''}`
                }
              }
            }
          }
        }
        return '  - (unknown action)'
      }).join('\n')
    : '  (no recent actions)'

  return `You are ${config.name}.

${config.personality}

Your goals: ${config.goals}

---

MEMORY SYSTEM

You have a persistent memory filesystem. Use the bash tool to read/write files:
- Read: cat, head, tail, grep
- Write: echo "content" >> file.md (append) or > file.md (overwrite)
- Organize: mkdir, ls, find, mv, rm

How you organize is up to you. Some approaches:
- A simple journal.md for running notes
- Folders by topic (people/, locations/, prices/)
- Structured files with sections

Memory persists across all your decisions. Use it to:
- Track what you've learned about areas and spawns
- Remember interactions with other agents
- Keep notes on prices and market observations
- Store any knowledge that helps you decide

IMPORTANT: Memory won't auto-load. Read what you need before deciding.

---

CURRENT SITUATION:

Location: ${world.self.area}
Gold: ${world.self.gold}g
Turns remaining: ${world.self.turns}/10
Time: Day ${world.time.day}, ${world.time.season}, ${world.time.timeOfDay}

Inventory:
${inventoryStr}

Skills:
${skillsStr}

---

WHAT YOU CAN SEE:

Spawns in ${world.self.area}:
${spawnsStr}

Others here:
${agentsStr}

Unread messages:
${messagesStr}

---

RECENT ACTIONS:
${recentActionsStr}

---

${diary ? `YOUR DIARY (your memories and thoughts):\n\n${diary}\n\n---\n\n` : ''}

Choose ONE action. When you speak (text output), you're narrating for viewers watching your life - keep it brief and authentic to your personality.`
}

// Version to detect old vs new code
const CODE_VERSION = '2026-01-16-v9'

// GET /status
app.get('/status', async (c) => {
  await log('DEBUG', 'Status check received')
  try {
    const config = await loadConfig()
    return c.json({ name: config.name, ready: true, version: CODE_VERSION, timestamp: new Date().toISOString() })
  } catch (err) {
    await log('ERROR', 'Status check failed', { error: String(err) })
    return c.json({ ready: false, error: 'Config not found' }, 500)
  }
})

// POST /turn
app.post('/turn', async (c) => {
  const requestStart = Date.now()
  await log('INFO', '========== TURN REQUEST START ==========')

  let body: TurnRequest
  try {
    body = await c.req.json<TurnRequest>()
  } catch (parseError) {
    await log('ERROR', 'Failed to parse request body', parseError)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { agentId, result: lastResult, world } = body

  await log('INFO', 'Turn request received', {
    agentId,
    area: world.self.area,
    turns: world.self.turns,
    gold: world.self.gold,
    hasLastResult: lastResult !== null,
  })

  // Load state
  let config: AgentConfig
  try {
    config = await loadConfig()
    await log('INFO', 'Config loaded', { name: config.name })
  } catch (configError) {
    await log('ERROR', 'Failed to load config', configError)
    return c.json({ error: 'Failed to load agent config', details: String(configError) }, 500)
  }

  const diary = await loadDiary()
  await log('DEBUG', 'Diary loaded', { length: diary.length })

  const recentTurns = await loadRecentTurns(10)
  await log('DEBUG', 'Recent turns loaded', { count: recentTurns.length })

  // Build system prompt (refreshed each turn with current world state)
  const systemPrompt = buildSystemPrompt(config, world, diary, recentTurns)

  // Load or create session (session state stored in control plane DB)
  let session = await loadSession(agentId)
  const isNewSession = !session

  if (isNewSession) {
    // Start fresh session
    session = {
      sessionId: crypto.randomUUID(),
      messages: [],
      startedAt: new Date().toISOString(),
      actionCount: 0,
      pendingToolUseId: null,
    }
    // Initial prompt
    session.messages.push({
      role: 'user',
      content: 'What do you want to do?',
    })
    await log('INFO', 'New session started', { sessionId: session.sessionId })
  } else {
    // Continue existing session - add result from last game action
    await log('INFO', 'Continuing session', {
      sessionId: session.sessionId,
      actionCount: session.actionCount,
      pendingToolUseId: session.pendingToolUseId,
    })

    if (session.pendingToolUseId && lastResult !== null && lastResult !== undefined) {
      // Add the game action result as a tool_result
      session.messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: session.pendingToolUseId,
          content: JSON.stringify(lastResult),
        }],
      })
      session.pendingToolUseId = null
      await log('INFO', 'Added tool result for previous action')
    }
  }

  // Reference to session messages for iteration
  const messages = session.messages

  try {
    let finalResponse: Anthropic.Message | null = null
    let shouldEndSession = false

    // Agentic loop: continue until Claude chooses a game action
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      await log('INFO', `Iteration ${iteration + 1}/${MAX_ITERATIONS}`, {
        messagesCount: messages.length,
      })

      const claudeStart = Date.now()
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages,
      })

      await log('INFO', 'Claude API responded', {
        durationMs: Date.now() - claudeStart,
        model: response.model,
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
      })

      // Strip signatures from thinking blocks
      const cleanContent = response.content.map(block => {
        if (block.type === 'thinking') {
          const { signature, ...rest } = block as typeof block & { signature?: string }
          return rest
        }
        return block
      })

      // Add assistant response to conversation
      messages.push({
        role: 'assistant',
        content: cleanContent as Anthropic.Messages.ContentBlockParam[],
      })

      // Check if Claude ended without tool use
      if (response.stop_reason === 'end_turn') {
        await log('INFO', 'Claude ended turn without tool use')
        finalResponse = response
        break
      }

      // Process tool uses - collect all results, execute game actions immediately
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
      let mustReturnToControlPlane = false
      let returnResponse = response

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        if (block.name === 'bash') {
          // Execute bash locally for memory operations
          const command = (block.input as { command: string }).command
          await log('INFO', 'Executing bash', { command })
          const result = await executeBash(command)
          await log('DEBUG', 'Bash result', { result: result.slice(0, 500) })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          })
        } else if (GAME_ACTIONS.has(block.name)) {
          // GAME ACTION - Execute immediately via control plane
          await log('INFO', 'Executing game action', { name: block.name, input: block.input })

          const actionResult = await executeGameAction(agentId, {
            name: block.name,
            input: block.input as Record<string, unknown>,
          })

          await log('INFO', 'Game action result', actionResult)
          session.actionCount++

          if (block.name === 'sleep') {
            // Sleep ends the session - clear and return
            await clearSession(agentId)
            await log('INFO', 'Sleep action - session cleared, returning')
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(actionResult),
            })
            mustReturnToControlPlane = true
            shouldEndSession = true
          } else if (actionResult.duration > 0) {
            // Timed action - save session and return, control plane will wake us when done
            session.pendingToolUseId = block.id
            await saveSession(agentId, session)
            await log('INFO', 'Timed action - session saved, returning to control plane', {
              duration: actionResult.duration,
              pendingToolUseId: block.id,
            })
            mustReturnToControlPlane = true
          } else {
            // Instant action - add result and continue loop
            await log('INFO', 'Instant action completed, continuing loop')
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(actionResult),
            })

            // Refresh world state after instant action (inventory may have changed, etc)
            try {
              const newWorld = await fetchWorldState(agentId)
              // Update system prompt would require rebuilding - for now, just continue
              // The world state in system prompt may be slightly stale but that's OK
              await log('DEBUG', 'World state refreshed after instant action')
            } catch (e) {
              await log('WARN', 'Failed to refresh world state', { error: String(e) })
            }
          }
        } else {
          await log('WARN', 'Unknown tool', { name: block.name })
        }
      }

      // If we need to return to control plane (timed action or sleep), do so
      if (mustReturnToControlPlane) {
        finalResponse = returnResponse
        break
      }

      // Feed all tool results back to Claude for next iteration
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults })
      } else {
        // No tool results at all - shouldn't happen, but break to avoid infinite loop
        await log('WARN', 'No tool results, breaking loop')
        finalResponse = response
        break
      }
    }

    if (!finalResponse) {
      await log('WARN', 'Max iterations reached without game action')
      return c.json({ error: 'Max iterations reached', iterations: MAX_ITERATIONS }, 500)
    }

    // Save turn record with full message history
    const turnId = await getNextTurnId()
    const turnRecord: TurnRecord = {
      turnId,
      at: new Date().toISOString(),
      messages,
    }
    await saveTurn(turnRecord)

    await log('INFO', 'Turn completed successfully', {
      turnId,
      sessionId: session.sessionId,
      actionCount: session.actionCount,
      isNewSession,
      totalDurationMs: Date.now() - requestStart,
      totalIterations: messages.filter(m => m.role === 'assistant').length,
    })
    await log('INFO', '========== TURN REQUEST END ==========')

    // Return Claude's final response to control plane
    return c.json(finalResponse)
  } catch (error) {
    await log('ERROR', 'Turn request failed', {
      durationMs: Date.now() - requestStart,
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    await log('INFO', '========== TURN REQUEST END (ERROR) ==========')
    return c.json({ error: String(error), type: error?.constructor?.name }, 500)
  }
})

const port = Number(process.env.PORT) || 8080

// Startup logging
log('INFO', 'Server starting', {
  port,
  pid: process.pid,
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  anthropicKeyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0, 10),
})

console.log(`Agent sprite running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
