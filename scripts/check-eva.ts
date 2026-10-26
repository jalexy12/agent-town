/**
 * Check Eva sprite logs
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function check() {
  const client = getSpritesClient()
  const sprite = await client.getSprite(getSpriteName('eva'))

  await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

  console.log('=== SERVER LOG ===')
  const logs = await sprite.execFile('bash', ['-c', 'tail -50 /app/server.log'])
  console.log(logs.stdout)

  console.log('\n=== SESSION STATE ===')
  const session = await sprite.execFile('bash', ['-c', 'cat /app/state/session.json 2>/dev/null || echo "no session"'])
  console.log(session.stdout)

  console.log('\n=== PROCESS CHECK ===')
  const procs = await sprite.execFile('bash', ['-c', 'ps aux | grep bun | grep -v grep || echo "no bun"'])
  console.log(procs.stdout)
}

check().catch(console.error)
