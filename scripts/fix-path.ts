/**
 * Fix the broken PATH in start.sh on all sprites
 * The bug: export PATH="/home/sprite/.bun/bin:\$PATH" (backslash escapes $)
 * The fix: export PATH="/home/sprite/.bun/bin:$PATH" (no backslash)
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { SpritesClient } from '@fly/sprites'

const client = new SpritesClient(process.env.SPRITES_TOKEN!)
const AGENTS = ['alice', 'bob', 'clara', 'dex', 'eva', 'finn']

async function fixSprite(agentId: string) {
  const sprite = client.sprite(`agent-town-${agentId}`)

  // Wake sprite
  await sprite.exec('echo wake')

  // Check current start.sh
  const before = await sprite.execFile('bash', ['-c', 'cat /app/start.sh'])
  console.log(`\n=== ${agentId} BEFORE ===`)
  console.log(before.stdout)

  // Fix: Use sed to replace the broken line
  // The broken line has \$PATH, we want $PATH
  await sprite.execFile('bash', ['-c',
    "sed -i 's|\\\\\\$PATH|\\$PATH|g' /app/start.sh"
  ])

  // Verify
  const after = await sprite.execFile('bash', ['-c', 'cat /app/start.sh'])
  console.log(`=== ${agentId} AFTER ===`)
  console.log(after.stdout)

  // Restart the server with fixed PATH
  console.log(`Restarting ${agentId} server...`)
  await sprite.execFile('bash', ['-c', 'pkill -9 bun 2>/dev/null || true; sleep 1'])
  await sprite.execFile('bash', ['-c', 'nohup /app/start.sh > /app/server.log 2>&1 &'])

  // Wait for server to start
  await new Promise(r => setTimeout(r, 3000))

  // Verify server has correct PATH now
  const proc = await sprite.execFile('bash', ['-c', "pgrep -f 'bun run' | head -1"])
  if (proc.stdout.trim()) {
    const env = await sprite.execFile('bash', ['-c',
      `cat /proc/${proc.stdout.trim()}/environ | tr '\\0' '\\n' | grep ^PATH=`
    ])
    console.log(`${agentId} server PATH: ${env.stdout.trim()}`)
  }
}

async function main() {
  console.log('Fixing PATH in start.sh on all sprites...\n')

  for (const agent of AGENTS) {
    try {
      await fixSprite(agent)
      console.log(`✓ ${agent} fixed\n`)
    } catch (e) {
      console.error(`✗ ${agent} failed:`, e)
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
