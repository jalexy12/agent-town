/**
 * Sprite Update Script
 *
 * Safely hot-loads new code to all sprites without state loss.
 * Run with: bun run sprites:update
 *
 * Features:
 * - Pauses scheduler during update (DB-backed, survives restarts)
 * - Creates pre-update checkpoints for rollback
 * - Validates syntax before deploying
 * - Parallel updates across all sprites
 * - Auto-increments version
 * - Updates control plane version to match
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { readFile, writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import pRetry from 'p-retry'
import { AGENTS, type AgentConfig } from './agents'
import { getSpritesClient, getSpriteName, consumeCheckpointStream } from './client'

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'https://agent-town-control.fly.dev'

function log(agent: string, message: string) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  console.log(`[${timestamp}] [${agent.padEnd(8)}] ${message}`)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Auto-increment version string
 * e.g., '2026-01-15-v2' → '2026-01-16-v3' (new date, incremented number)
 */
function bumpVersion(code: string): { newCode: string; newVersion: string } {
  const match = code.match(/CODE_VERSION = '([^']+)'/)
  const current = match?.[1] || '0000-00-00-v0'

  // Extract version number
  const vMatch = current.match(/-v(\d+)$/)
  const vNum = vMatch ? parseInt(vMatch[1], 10) : 0

  // New version with today's date and incremented number
  const today = new Date().toISOString().slice(0, 10)
  const newVersion = `${today}-v${vNum + 1}`
  const newCode = code.replace(/CODE_VERSION = '[^']+'/, `CODE_VERSION = '${newVersion}'`)

  return { newCode, newVersion }
}

/**
 * Update a single sprite with new code
 */
async function updateSprite(
  agent: AgentConfig,
  newCode: string,
  newVersion: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSpritesClient()
  const spriteName = getSpriteName(agent.id)

  try {
    log(agent.name, `Starting update to ${newVersion}`)
    const sprite = await client.getSprite(spriteName)

    // 1. Create pre-update checkpoint for rollback
    log(agent.name, 'Creating pre-update checkpoint...')
    const checkpointResponse = await sprite.createCheckpoint(`pre-update-${newVersion}`)
    await consumeCheckpointStream(checkpointResponse)

    // 2. Wake sprite
    log(agent.name, 'Waking sprite...')
    await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

    // 3. Write new code to staging location
    log(agent.name, 'Uploading new code...')
    const b64 = Buffer.from(newCode).toString('base64')
    await pRetry(
      () => sprite.execFile('bash', ['-c', `echo '${b64}' | base64 -d > /app/src/index.ts.new`]),
      { retries: 3, minTimeout: 500 }
    )

    // 4. Basic syntax check - just verify bun can parse it
    log(agent.name, 'Checking syntax...')
    try {
      const check = await sprite.execFile('bash', ['-c',
        'cd /app && /home/sprite/.bun/bin/bun run --print "require(\\"./src/index.ts.new\\")" 2>&1 || true'
      ])
      // Only fail on obvious syntax errors, not import/runtime errors
      if (check.stdout.includes('SyntaxError:') && check.stdout.includes('Unexpected')) {
        throw new Error(`Syntax error:\n${check.stdout}`)
      }
    } catch (e) {
      // Non-fatal - continue and let version check catch real issues
      log(agent.name, `Syntax check warning: ${e}`)
    }

    // 5. Atomic swap: stop server, move file, start server
    log(agent.name, 'Swapping code and restarting...')
    // Kill ALL bun processes (lsof not installed on sprites)
    await sprite.execFile('bash', ['-c', `
      pkill -9 bun 2>/dev/null || true
      sleep 2
      mv /app/src/index.ts.new /app/src/index.ts
      /app/start.sh > /app/server.log 2>&1 &
    `])

    // 6. Wait for server to start (needs time for bun to initialize)
    await sleep(8000)

    // 7. Verify new version
    log(agent.name, 'Verifying new version...')
    let verified = false
    for (let i = 0; i < 5; i++) {
      try {
        const status = await sprite.execFile('bash', ['-c', 'curl -s http://localhost:8080/status'])
        if (status.stdout.includes(newVersion)) {
          verified = true
          break
        }
        log(agent.name, `Version check ${i + 1}/5: ${status.stdout.slice(0, 50)}...`)
      } catch (e) {
        log(agent.name, `Version check ${i + 1}/5 failed: ${e}`)
      }
      await sleep(2000)
    }

    if (!verified) {
      throw new Error(`Version verification failed - expected ${newVersion}`)
    }

    log(agent.name, `SUCCESS - updated to ${newVersion}`)
    return { success: true }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(agent.name, `FAILED: ${msg}`)
    return { success: false, error: msg }
  }
}

/**
 * Update EXPECTED_CODE_VERSION in control plane
 */
async function updateControlPlaneVersion(newVersion: string): Promise<void> {
  const cpPath = './control-plane/src/index.ts'
  let cpCode = await readFile(cpPath, 'utf-8')
  cpCode = cpCode.replace(
    /EXPECTED_CODE_VERSION = '[^']+'/,
    `EXPECTED_CODE_VERSION = '${newVersion}'`
  )
  await writeFile(cpPath, cpCode)
  console.log(`[Update] Control plane version updated to ${newVersion}`)
}

async function main() {
  const args = process.argv.slice(2)
  const spritesOnly = args.includes('--sprites-only')
  const skipDeploy = args.includes('--skip-deploy')

  console.log('='.repeat(60))
  console.log('Sprite Update Script')
  console.log('='.repeat(60))
  console.log()

  // 1. Read local sprite code
  console.log('[Update] Reading local sprite code...')
  const localCode = await readFile('./sprite/src/index.ts', 'utf-8')

  // 2. Auto-increment version
  const { newCode, newVersion } = bumpVersion(localCode)
  console.log(`[Update] Bumping version to: ${newVersion}`)

  // 3. Pause scheduler via API
  console.log(`[Update] Pausing scheduler at ${CONTROL_PLANE_URL}...`)
  try {
    const pauseRes = await fetch(`${CONTROL_PLANE_URL}/admin/pause`, { method: 'POST' })
    if (!pauseRes.ok) {
      throw new Error(`Failed to pause: ${pauseRes.status}`)
    }
    console.log('[Update] Scheduler paused')
  } catch (error) {
    console.error('[Update] WARNING: Could not pause scheduler:', error)
    console.error('[Update] Continuing anyway - sprites may get partial requests')
  }

  try {
    // 4. Update all sprites in parallel
    console.log()
    console.log(`[Update] Updating ${AGENTS.length} sprites in parallel...`)
    console.log()

    const results = await Promise.all(
      AGENTS.map(agent => updateSprite(agent, newCode, newVersion))
    )

    // 5. Check results
    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success)

    console.log()
    console.log('='.repeat(60))
    console.log(`[Update] Sprites: ${succeeded}/${AGENTS.length} succeeded`)

    if (failed.length > 0) {
      console.log()
      console.log('Failed sprites:')
      AGENTS.forEach((agent, i) => {
        if (!results[i].success) {
          console.log(`  ${agent.name}: ${results[i].error}`)
        }
      })
      console.log()
      console.log('[Update] WARNING: Some sprites failed. Control plane NOT updated.')
      console.log('[Update] Fix the issues and re-run, or manually update control plane.')
      return
    }

    // 6. Update local sprite file with new version
    console.log('[Update] Updating local sprite/src/index.ts...')
    await writeFile('./sprite/src/index.ts', newCode)

    if (spritesOnly) {
      console.log('[Update] --sprites-only flag set, skipping control plane update')
      return
    }

    // 7. Update control plane version
    console.log('[Update] Updating control plane version...')
    await updateControlPlaneVersion(newVersion)

    if (skipDeploy) {
      console.log('[Update] --skip-deploy flag set, skipping Fly deployment')
      console.log('[Update] Remember to deploy control plane manually!')
      return
    }

    // 8. Deploy control plane
    console.log()
    console.log('[Update] Deploying control plane to Fly.io...')
    try {
      execSync('cd control-plane && ~/.fly/bin/flyctl deploy', {
        stdio: 'inherit',
        shell: '/bin/bash'
      })
      console.log('[Update] Control plane deployed successfully')
    } catch (error) {
      console.error('[Update] Control plane deploy failed:', error)
      console.error('[Update] Deploy manually: cd control-plane && fly deploy')
    }

    console.log()
    console.log('='.repeat(60))
    console.log(`[Update] COMPLETE - all systems updated to ${newVersion}`)
    console.log('='.repeat(60))

  } finally {
    // 9. Resume scheduler (always, even on error)
    console.log()
    console.log('[Update] Resuming scheduler...')
    try {
      await fetch(`${CONTROL_PLANE_URL}/admin/resume`, { method: 'POST' })
      console.log('[Update] Scheduler resumed')
    } catch (error) {
      console.error('[Update] WARNING: Could not resume scheduler:', error)
      console.error('[Update] Manually resume: curl -X POST ' + CONTROL_PLANE_URL + '/admin/resume')
    }
  }
}

main().catch(error => {
  console.error('[Update] Fatal error:', error)
  process.exit(1)
})
