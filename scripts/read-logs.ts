/**
 * Read logs from a sprite
 * Usage: bun run scripts/read-logs.ts <agent-id>
 * Example: bun run scripts/read-logs.ts alice
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { SpritesClient } from '@fly/sprites'

const agentId = process.argv[2]
if (!agentId) {
  console.error('Usage: bun run scripts/read-logs.ts <agent-id>')
  console.error('Example: bun run scripts/read-logs.ts alice')
  process.exit(1)
}

const client = new SpritesClient(process.env.SPRITES_TOKEN!)
const spriteName = `agent-town-${agentId}`

console.log(`Reading logs from ${spriteName}...`)
console.log('='.repeat(60))

try {
  const sprite = await client.getSprite(spriteName)

  // Wake sprite
  await sprite.exec('echo wake')

  // Read the log file
  const logResult = await sprite.execFile('bash', ['-c', 'cat /app/state/sprite.log 2>/dev/null || echo "(no logs yet)"'])
  console.log(logResult.stdout)

  console.log('='.repeat(60))

  // Also show server.log for comparison
  console.log('\nserver.log (startup/crash output):')
  console.log('='.repeat(60))
  const serverLogResult = await sprite.execFile('bash', ['-c', 'cat /app/server.log 2>/dev/null || echo "(no server.log)"'])
  console.log(serverLogResult.stdout)

} catch (error) {
  console.error('Error:', error)
  process.exit(1)
}
