/**
 * Sprite Diagnostic Script
 *
 * Checks the actual state of each sprite:
 * - Code version on disk
 * - Running processes
 * - Server response
 * - Server logs
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { AGENTS } from './agents'
import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function diagnose() {
  const client = getSpritesClient()

  console.log('='.repeat(70))
  console.log('SPRITE DIAGNOSTIC')
  console.log('='.repeat(70))
  console.log()

  for (const agent of AGENTS) {
    const spriteName = getSpriteName(agent.id)
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`${agent.name} (${spriteName})`)
    console.log(`${'─'.repeat(60)}`)

    try {
      const sprite = await client.getSprite(spriteName)

      // Wake it
      await pRetry(() => sprite.exec('echo wake'), { retries: 2, minTimeout: 500 })

      // 1. Code version on disk
      console.log('\n[1] CODE ON DISK:')
      const diskCode = await sprite.execFile('bash', ['-c', 'grep "CODE_VERSION" /app/src/index.ts | head -1'])
      console.log(`    ${diskCode.stdout.trim()}`)

      // 2. Running processes
      console.log('\n[2] RUNNING PROCESSES:')
      const procs = await sprite.execFile('bash', ['-c', 'ps aux | grep -E "bun|node" | grep -v grep || echo "none"'])
      console.log(`    ${procs.stdout.trim().replace(/\n/g, '\n    ')}`)

      // 3. What's on port 8080?
      console.log('\n[3] PORT 8080 (lsof):')
      const lsof = await sprite.execFile('bash', ['-c', 'lsof -i:8080 || echo "nothing on 8080"'])
      console.log(`    ${lsof.stdout.trim().replace(/\n/g, '\n    ')}`)

      // 4. HTTP status check
      console.log('\n[4] HTTP STATUS:')
      const status = await sprite.execFile('bash', ['-c', 'curl -s http://localhost:8080/status || echo "connection failed"'])
      console.log(`    ${status.stdout.trim()}`)

      // 5. Server logs (last 10 lines)
      console.log('\n[5] SERVER LOGS (last 10):')
      const logs = await sprite.execFile('bash', ['-c', 'tail -10 /app/server.log 2>/dev/null || echo "no log file"'])
      console.log(`    ${logs.stdout.trim().replace(/\n/g, '\n    ')}`)

    } catch (error) {
      console.log(`ERROR: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('END DIAGNOSTIC')
  console.log('='.repeat(70))
}

diagnose().catch(console.error)
