/**
 * Check all sprites for stale sessions
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { AGENTS } from './agents'
import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function check() {
  const client = getSpritesClient()

  console.log('Checking all sprite sessions...\n')

  for (const agent of AGENTS) {
    const sprite = await client.getSprite(getSpriteName(agent.id))

    try {
      await pRetry(() => sprite.exec('echo wake'), { retries: 2, minTimeout: 500 })

      const session = await sprite.execFile('bash', ['-c', 'cat /app/state/session.json 2>/dev/null || echo "null"'])
      const sessionData = session.stdout.trim()

      if (sessionData === 'null') {
        console.log(`[${agent.name}] No session`)
      } else {
        const parsed = JSON.parse(sessionData)
        console.log(`[${agent.name}] Session exists:`)
        console.log(`  - sessionId: ${parsed.sessionId}`)
        console.log(`  - actionCount: ${parsed.actionCount}`)
        console.log(`  - pendingToolUseId: ${parsed.pendingToolUseId || 'none'}`)
        console.log(`  - messages: ${parsed.messages?.length || 0}`)
        console.log(`  - startedAt: ${parsed.startedAt}`)
      }
    } catch (error) {
      console.log(`[${agent.name}] ERROR: ${error instanceof Error ? error.message : error}`)
    }
    console.log()
  }
}

check().catch(console.error)
