/**
 * Sprite Status Script
 *
 * Checks the status of all agent sprites.
 * Run with: bun run sprites:status
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { AGENTS } from './agents'
import { getSpritesClient, getSpriteName } from './client'

async function main() {
  if (!process.env.SPRITES_TOKEN) {
    console.error('SPRITES_TOKEN required')
    process.exit(1)
  }

  const client = getSpritesClient()

  console.log('Sprite Status')
  console.log('='.repeat(60))
  console.log()
  console.log('Agent'.padEnd(8), 'Exists'.padEnd(10), 'Server'.padEnd(10), 'Checkpoints')
  console.log('-'.repeat(60))

  for (const agent of AGENTS) {
    const spriteName = getSpriteName(agent.id)
    const sprite = client.sprite(spriteName)

    let exists = false
    let serverOk = false
    let checkpoints: string[] = []

    try {
      await sprite.exec('echo ok')
      exists = true

      // Check server health
      try {
        const health = await sprite.exec('curl -s http://localhost:4001/status')
        serverOk = health.stdout.includes('ready')
      } catch {
        serverOk = false
      }

      // Get checkpoints using SDK
      try {
        const cps = await sprite.listCheckpoints()
        checkpoints = cps.map(c => c.id)
      } catch {
        // No checkpoints
      }
    } catch {
      // Sprite doesn't exist
    }

    console.log(
      agent.name.padEnd(8),
      (exists ? 'yes' : 'no').padEnd(10),
      (serverOk ? 'healthy' : '-').padEnd(10),
      checkpoints.join(', ') || '-'
    )
  }

  console.log()
}

main().catch(console.error)
