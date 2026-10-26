/**
 * Force restart all sprite servers IN PARALLEL
 *
 * Kills ALL bun processes and restarts fresh.
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { AGENTS } from './agents'
import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function restartOne(agentId: string, agentName: string) {
  const client = getSpritesClient()
  const spriteName = getSpriteName(agentId)
  console.log(`[${agentName}] Starting...`)

  try {
    const sprite = await client.getSprite(spriteName)

    // Wake
    await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

    // Kill ALL bun processes
    await sprite.execFile('bash', ['-c', 'pkill -9 bun 2>/dev/null || true; sleep 2'])

    // Start server
    await sprite.execFile('bash', ['-c', 'cd /app && /app/start.sh > /app/server.log 2>&1 &'])

    // Wait for startup
    await new Promise(r => setTimeout(r, 8000))

    // Verify
    const status = await sprite.execFile('bash', ['-c', 'curl -s http://localhost:8080/status'])
    const match = status.stdout.match(/"version":"([^"]+)"/)
    const version = match?.[1] || 'unknown'

    if (version.includes('v7')) {
      console.log(`[${agentName}] ✓ v7`)
      return { name: agentName, success: true, version }
    } else {
      console.log(`[${agentName}] ✗ ${version}`)
      return { name: agentName, success: false, error: version }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`[${agentName}] ERROR: ${msg.slice(0, 50)}`)
    return { name: agentName, success: false, error: msg }
  }
}

async function main() {
  console.log('FORCE RESTART ALL SPRITES (PARALLEL)\n')

  const results = await Promise.all(
    AGENTS.map(a => restartOne(a.id, a.name))
  )

  console.log('\n=== SUMMARY ===')
  for (const r of results) {
    console.log(`${r.success ? '✓' : '✗'} ${r.name}: ${r.success ? r.version : r.error}`)
  }
}

main().catch(console.error)
