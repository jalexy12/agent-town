import { agents, inventory, skills, spawns, listings, messages, events, world } from './db/repositories'
import { deductTurn } from './db/repositories/agents'
import { executeAction, completeAction, type ToolUse } from './actions'
import type { Area } from './state'

const TICK_INTERVAL = 5000        // Check every 5 seconds
const REGEN_INTERVAL = 60000      // Check regen every minute
const TIME_ADVANCE_INTERVAL = 15 * 60 * 1000  // Advance time of day every 15 real minutes
const DAYS_PER_SEASON = 7         // Season changes every 7 game days

// Dev mode: SPRITE_BASE_URL set = all agents hit one sprite
// Prod mode: SPRITE_BASE_URL not set = each agent uses their DB spriteUrl
const IS_DEV = !!process.env.SPRITE_BASE_URL

function getSpriteUrl(agent: { spriteUrl: string }): string {
  return IS_DEV ? process.env.SPRITE_BASE_URL! : agent.spriteUrl
}

const TIME_OF_DAY_CYCLE = ['dawn', 'day', 'dusk', 'night'] as const
const SEASON_CYCLE = ['spring', 'summer', 'fall', 'winter'] as const

type BroadcastFn = (data: { type: string; [key: string]: unknown }) => void
type BuildWorldStateFn = (agentId: string) => Promise<unknown>
type WakeSpriteFn = (agentId: string) => Promise<void>
type IsSchedulerPausedFn = () => Promise<boolean>

let broadcast: BroadcastFn
let buildWorldState: BuildWorldStateFn
let wakeSprite: WakeSpriteFn
let isSchedulerPaused: IsSchedulerPausedFn

export function startScheduler(options: {
  broadcast: BroadcastFn
  buildWorldState: BuildWorldStateFn
  wakeSprite: WakeSpriteFn
  isSchedulerPaused: IsSchedulerPausedFn
}) {
  broadcast = options.broadcast
  buildWorldState = options.buildWorldState
  wakeSprite = options.wakeSprite
  isSchedulerPaused = options.isSchedulerPaused

  console.log('[Scheduler] Starting game loop...')
  console.log(`[Scheduler] Tick: ${TICK_INTERVAL}ms, Regen: ${REGEN_INTERVAL}ms, Time advance: ${TIME_ADVANCE_INTERVAL}ms`)
  console.log(`[Scheduler] 1 game day = ${(TIME_ADVANCE_INTERVAL * 4) / 60000} real minutes, season changes every ${DAYS_PER_SEASON} days`)

  // Start all loops
  scheduleNextTick()
  scheduleNextRegen()
  scheduleNextTimeAdvance()
}

// Recursive setTimeout pattern - prevents overlap, handles errors gracefully
function scheduleNextTick() {
  setTimeout(async () => {
    const startTime = Date.now()
    try {
      await checkCompletedActions()
    } catch (error) {
      console.error('[Scheduler] Error in tick:', error)
    }
    // Schedule next tick, accounting for execution time
    const elapsed = Date.now() - startTime
    const nextDelay = Math.max(100, TICK_INTERVAL - elapsed)
    scheduleNextTick()
  }, TICK_INTERVAL)
}

function scheduleNextRegen() {
  setTimeout(async () => {
    try {
      await regenerateTurns()
    } catch (error) {
      console.error('[Scheduler] Error in regen:', error)
    }
    scheduleNextRegen()
  }, REGEN_INTERVAL)
}

function scheduleNextTimeAdvance() {
  setTimeout(async () => {
    try {
      await advanceTime()
    } catch (error) {
      console.error('[Scheduler] Error in time advance:', error)
    }
    scheduleNextTimeAdvance()
  }, TIME_ADVANCE_INTERVAL)
}

async function advanceTime() {
  const worldState = await world.getAll()
  const currentTimeOfDay = (worldState.time_of_day?.valueText ?? 'day') as typeof TIME_OF_DAY_CYCLE[number]
  const currentDay = worldState.day?.valueInt ?? 1
  const currentSeason = (worldState.season?.valueText ?? 'spring') as typeof SEASON_CYCLE[number]

  // Find next time of day
  const currentTimeIndex = TIME_OF_DAY_CYCLE.indexOf(currentTimeOfDay)
  const nextTimeIndex = (currentTimeIndex + 1) % TIME_OF_DAY_CYCLE.length
  const nextTimeOfDay = TIME_OF_DAY_CYCLE[nextTimeIndex]

  await world.setTextValue('time_of_day', nextTimeOfDay)
  console.log(`[Scheduler] Time advanced: ${currentTimeOfDay} → ${nextTimeOfDay}`)

  // If we cycled back to dawn, it's a new day
  if (nextTimeOfDay === 'dawn') {
    const newDay = await world.incrementDay()
    console.log(`[Scheduler] New day: ${newDay}`)

    // Check for season change
    if (newDay % DAYS_PER_SEASON === 1 && newDay > 1) {
      const currentSeasonIndex = SEASON_CYCLE.indexOf(currentSeason)
      const nextSeasonIndex = (currentSeasonIndex + 1) % SEASON_CYCLE.length
      const nextSeason = SEASON_CYCLE[nextSeasonIndex]

      await world.setTextValue('season', nextSeason)
      console.log(`[Scheduler] Season changed: ${currentSeason} → ${nextSeason}`)

      broadcast({
        type: 'SEASON_CHANGE',
        season: nextSeason,
        day: newDay,
      })
    }

    broadcast({
      type: 'TIME_UPDATE',
      day: newDay,
      timeOfDay: nextTimeOfDay,
      season: currentSeason,
    })
  } else {
    broadcast({
      type: 'TIME_UPDATE',
      day: currentDay,
      timeOfDay: nextTimeOfDay,
      season: currentSeason,
    })
  }
}

async function checkCompletedActions() {
  // Skip if scheduler is paused (during sprite updates)
  if (await isSchedulerPaused()) {
    return
  }

  // 1. Wake agents whose actions have completed
  const completed = await agents.getAgentsWithCompletedActions()

  if (completed.length > 0) {
    console.log(`[Scheduler] Found ${completed.length} agents with completed actions`)
  }

  for (const agent of completed) {
    console.log(`[Scheduler] Agent ${agent.name} action completed (${agent.currentAction}), processing...`)
    try {
      // Process the completion to get results (spawn creation, inventory updates, etc)
      const completionResult = await completeAction(agent.id)
      console.log(`[Scheduler] ${agent.name} completion result:`, completionResult)

      // Clear action state before waking
      await agents.updateAgent(agent.id, {
        status: 'idle',
        currentAction: null,
        actionCompletesAt: null,
        actionData: null,
      })

      // Wake agent with the result
      await wakeAgent(agent.id, completionResult)
    } catch (error) {
      console.error(`[Scheduler] Error processing agent ${agent.name}:`, error)
    }
  }

  // 2. Wake idle agents who have turns and should be acting
  const idle = await agents.getIdleAgentsWithTurns()

  if (idle.length > 0) {
    console.log(`[Scheduler] Found ${idle.length} idle agents to wake`)
  }

  for (const agent of idle) {
    console.log(`[Scheduler] Waking idle agent ${agent.name} (${agent.turns} turns)...`)
    try {
      await wakeAgent(agent.id, { idle: true })
    } catch (error) {
      console.error(`[Scheduler] Error waking idle agent ${agent.name}:`, error)
    }
  }
}

const MAX_INSTANT_ACTIONS = 3  // Prevent infinite loops from instant actions

async function wakeAgent(agentId: string, result: unknown, instantActionCount = 0): Promise<void> {
  const agent = await agents.getAgent(agentId)
  if (!agent) {
    console.error(`[Scheduler] Agent ${agentId} not found`)
    return
  }

  console.log(`[Scheduler] Building world state for ${agent.name}...`)

  // Build world state and call sprite
  const worldState = await buildWorldState(agentId)

  // Wake sprite VM and ensure server is running
  console.log(`[Scheduler] Waking sprite for ${agent.name}...`)
  await wakeSprite(agentId)

  const spriteUrl = getSpriteUrl(agent)
  console.log(`[Scheduler] Calling sprite at ${spriteUrl}/turn`)

  const response = await fetch(`${spriteUrl}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, result, world: worldState }),
  })

  if (!response.ok) {
    console.error(`[Scheduler] Sprite returned ${response.status}: ${await response.text()}`)
    // Mark agent as idle so they can be woken again
    await agents.updateAgent(agentId, {
      status: 'idle',
      currentAction: null,
      actionCompletesAt: null,
    })
    return
  }

  const message = await response.json() as {
    content: Array<
      | { type: 'thinking'; thinking: string }
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >
  }

  console.log(`[Scheduler] ${agent.name} response received`)

  // Extract tool_use from Claude's response
  const toolUse = message.content.find((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
    b.type === 'tool_use'
  )

  if (!toolUse) {
    console.log(`[Scheduler] ${agent.name} returned no action, marking idle`)
    await agents.updateAgent(agentId, {
      status: 'idle',
      currentAction: null,
      actionCompletesAt: null,
    })
    return
  }

  console.log(`[Scheduler] ${agent.name} chose action: ${toolUse.name}`)

  // Execute the action
  const actionResult = await executeAction(agentId, toolUse as ToolUse)

  // Deduct turn on successful action
  if (actionResult.success) {
    await deductTurn(agentId)
  }

  // Record the turn event
  await events.recordEvent('turn', agentId, { message })

  // Broadcast to UI
  broadcast({ type: 'TURN', agentId, message })
  broadcast({ type: 'AGENT_UPDATE', agent: await agents.getAgent(agentId) })

  // If instant action succeeded, immediately loop for next decision
  if (actionResult.duration === 0 && actionResult.success && toolUse.name !== 'sleep') {
    if (instantActionCount >= MAX_INSTANT_ACTIONS) {
      console.log(`[Scheduler] ${agent.name} hit instant action limit (${MAX_INSTANT_ACTIONS}), breaking loop`)
      return
    }
    console.log(`[Scheduler] ${agent.name} instant action (${instantActionCount + 1}/${MAX_INSTANT_ACTIONS}), getting next decision...`)
    return wakeAgent(agentId, actionResult.result, instantActionCount + 1)
  }

  if (actionResult.duration > 0) {
    console.log(`[Scheduler] ${agent.name} action will complete in ${actionResult.duration}ms`)
  }
}

async function regenerateTurns() {
  const regenAgents = await agents.getAgentsForTurnRegen()

  for (const agent of regenAgents) {
    const currentTurns = Number(agent.turns)
    // Regen rate per minute: idle = 1/90, sleeping = 2/90
    const regenRate = agent.status === 'sleeping' ? 2 / 90 : 1 / 90
    const newTurns = Math.min(10, currentTurns + regenRate)

    await agents.updateAgent(agent.id, { turns: newTurns.toFixed(2) })

    // Wake sleeping agents when turns are full
    if (agent.status === 'sleeping' && newTurns >= 10) {
      console.log(`[Scheduler] ${agent.name} turns full (${newTurns.toFixed(2)}), waking from sleep...`)
      await agents.updateAgent(agent.id, { status: 'idle' })
      try {
        await wakeAgent(agent.id, { wokeFromSleep: true })
      } catch (error) {
        console.error(`[Scheduler] Error waking ${agent.name} from sleep:`, error)
      }
    }
  }
}
