/**
 * Clear a sprite's session to reset their state
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

const agentId = process.argv[2] || 'eva'

async function clearSession() {
  const client = getSpritesClient()
  const sprite = await client.getSprite(getSpriteName(agentId))

  await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

  console.log(`Clearing session for ${agentId}...`)
  await sprite.execFile('bash', ['-c', 'rm -f /app/state/session.json'])

  // Verify
  const check = await sprite.execFile('bash', ['-c', 'cat /app/state/session.json 2>&1 || echo "session cleared"'])
  console.log(check.stdout)
}

clearSession().catch(console.error)
