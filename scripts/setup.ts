/**
 * Sprite Setup Script
 *
 * Provisions sprites for each agent on sprites.dev and creates initial checkpoints.
 * Run with: bun run sprites:setup
 */

import { config } from 'dotenv'
// Load env BEFORE any imports that use process.env
config({ path: './control-plane/.env' })

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pRetry from 'p-retry'
import { AGENTS, type AgentConfig } from './agents'
import { getSpritesClient, getSpriteName, consumeCheckpointStream } from './client'
import { eq } from 'drizzle-orm'
import type { Sprite } from '@fly/sprites'

// Dynamic import to ensure env is loaded first
const { db, agents } = await import('../control-plane/src/db')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function log(agent: string, message: string) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  console.log(`[${timestamp}] [${agent.padEnd(6)}] ${message}`)
}

/**
 * Check if error is a transient WebSocket failure that should be retried
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('websocket not open')) return true
    if (msg.includes('socket hang up')) return true
    if (msg.includes('connection reset')) return true
    if (msg.includes('econnreset')) return true
    if (msg.includes('etimedout')) return true
    if (msg.includes('exit code 255')) return true
    if (msg.includes('exit code -1')) return true
  }
  // Check for exit codes -1 or 255 (WebSocket disconnection) - check deeply
  const checkExitCode = (obj: unknown): boolean => {
    if (typeof obj !== 'object' || obj === null) return false
    const o = obj as Record<string, unknown>
    if (o.exitCode === -1 || o.exitCode === 255) return true
    if (o.result && typeof o.result === 'object') {
      const r = o.result as Record<string, unknown>
      if (r.exitCode === -1 || r.exitCode === 255) return true
    }
    return false
  }
  if (checkExitCode(error)) return true
  return false
}

const retryOpts = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 5000,
  onFailedAttempt: (error: pRetry.FailedAttemptError) => {
    // Check if it's an exit code 255 (WebSocket disconnect) - these are always transient
    const anyError = error as any
    const exitCode = anyError.result?.exitCode ?? anyError.cause?.result?.exitCode ?? anyError.error?.result?.exitCode
    if (exitCode === 255 || exitCode === -1) {
      console.log(`[Retry] Attempt ${error.attemptNumber}, exitCode ${exitCode} - will retry`)
      return // Allow retry
    }
    // For other errors, check if transient
    if (!isTransientError(error)) {
      throw error // Don't retry non-transient errors
    }
    console.log(`[Retry] Attempt ${error.attemptNumber} - will retry (transient)`)
  }
}

/**
 * Run a shell command (use execFile to avoid parsing issues)
 */
async function shell(sprite: Sprite, command: string): Promise<string> {
  return pRetry(async () => {
    const r = await sprite.execFile('bash', ['-c', command])
    return r.stdout as string
  }, retryOpts)
}

/**
 * Write file content to sprite
 */
async function writeFile(sprite: Sprite, path: string, content: string): Promise<void> {
  const b64 = Buffer.from(content).toString('base64')
  await pRetry(
    () => sprite.execFile('bash', ['-c', `echo '${b64}' | base64 -d > ${path}`]),
    retryOpts
  )
}

/**
 * Setup a single agent sprite
 */
async function setupAgent(
  agent: AgentConfig,
  client: ReturnType<typeof getSpritesClient>,
  spriteSrc: string,
  spritePackage: string
): Promise<{ success: boolean; error?: string }> {
  const spriteName = getSpriteName(agent.id)

  try {
    log(agent.name, `Setting up ${spriteName}`)

    // Get or create sprite
    let sprite: Sprite
    try {
      sprite = await client.getSprite(spriteName)
      log(agent.name, 'Using existing sprite')
    } catch {
      log(agent.name, 'Creating sprite...')
      await client.createSprite(spriteName, { ramMB: 512, cpus: 1 })
      sprite = await client.getSprite(spriteName)
    }

    // Make URL public (for dev - control plane needs to call it)
    await fetch(`https://api.sprites.dev/v1/sprites/${spriteName}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.SPRITES_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url_settings: { auth: 'public' } }),
    })

    // Wake it up
    await pRetry(() => sprite.exec('echo ready'), retryOpts)

    // Install bun
    log(agent.name, 'Installing bun...')
    await pRetry(() => sprite.exec('curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh'), retryOpts)
    await shell(sprite, 'bash /tmp/bun-install.sh')

    // Clear old state and create directories
    log(agent.name, 'Creating directories...')
    await shell(sprite, 'rm -rf /app/state')
    await pRetry(() => sprite.exec('mkdir -p /app/src /app/config /app/state/turns'), retryOpts)

    // Write files
    log(agent.name, 'Uploading files...')
    await writeFile(sprite, '/app/package.json', spritePackage)
    await writeFile(sprite, '/app/src/index.ts', spriteSrc)
    await writeFile(sprite, '/app/config/agent.json', JSON.stringify({
      name: agent.name,
      personality: agent.personality,
      goals: agent.goals,
    }, null, 2))

    // Install dependencies
    log(agent.name, 'Installing dependencies...')
    await shell(sprite, 'cd /app && /home/sprite/.bun/bin/bun install')

    // Create startup script
    log(agent.name, 'Creating startup script...')
    const startScript = `#!/bin/bash
export PATH="/home/sprite/.bun/bin:$PATH"
export ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"
cd /app
exec bun run src/index.ts
`
    await writeFile(sprite, '/app/start.sh', startScript)
    await pRetry(() => sprite.exec('chmod +x /app/start.sh'), retryOpts)

    // Kill any existing server - we checkpoint WITHOUT server running
    log(agent.name, 'Killing any existing server...')
    try {
      await sprite.execFile('bash', ['-c', 'killall bun 2>/dev/null; sleep 1; true'])
    } catch {
      // Ignore if no process to kill
    }

    // Create checkpoint WITHOUT server running
    // Server will be started by control plane on wake
    log(agent.name, 'Creating checkpoint (no server)...')
    const checkpointResponse = await sprite.createCheckpoint('initial')
    await consumeCheckpointStream(checkpointResponse)

    // Start server for immediate testing (will be killed on next checkpoint restore)
    log(agent.name, 'Starting server for testing...')
    await shell(sprite, 'nohup /app/start.sh > /app/server.log 2>&1 &')
    await new Promise(r => setTimeout(r, 2000))

    // Get sprite URL
    sprite = await client.getSprite(spriteName)
    const spriteUrl = (sprite as any).url || `https://${spriteName}.sprites.app`

    // Update DB
    await db.update(agents)
      .set({ spriteUrl })
      .where(eq(agents.id, agent.id))

    log(agent.name, `SUCCESS - ${spriteUrl}`)
    return { success: true }
  } catch (error) {
    let msg: string
    if (error instanceof Error) {
      msg = error.message
      if ((error as any).result) {
        msg += ` - stdout: ${(error as any).result.stdout}, stderr: ${(error as any).result.stderr}`
      }
    } else {
      msg = JSON.stringify(error)
    }
    log(agent.name, `FAILED: ${msg}`)
    return { success: false, error: msg }
  }
}

async function main() {
  if (!process.env.SPRITES_TOKEN) {
    console.error('SPRITES_TOKEN required')
    process.exit(1)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required')
    process.exit(1)
  }

  const client = getSpritesClient()
  const spriteSrc = await readFile(join(__dirname, '../sprite/src/index.ts'), 'utf-8')
  const spritePackage = await readFile(join(__dirname, '../sprite/package.json'), 'utf-8')

  console.log('='.repeat(50))
  console.log(`Setting up ${AGENTS.length} sprites...`)
  console.log('='.repeat(50))
  console.log()

  const results: Array<{ success: boolean; error?: string }> = []
  for (const agent of AGENTS) {
    results.push(await setupAgent(agent, client, spriteSrc, spritePackage))
  }

  console.log()
  console.log('='.repeat(50))
  const ok = results.filter(r => r.success).length
  console.log(`Done: ${ok}/${AGENTS.length} succeeded`)

  if (ok < AGENTS.length) {
    console.log('\nFailed:')
    AGENTS.forEach((a, i) => {
      if (!results[i].success) console.log(`  ${a.name}: ${results[i].error}`)
    })
  }
}

main().catch(console.error)
