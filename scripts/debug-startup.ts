/**
 * Debug sprite startup - check for crashes
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function debug() {
  const client = getSpritesClient()
  const sprite = await client.getSprite(getSpriteName('bob'))

  await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

  // Kill existing
  console.log('Killing existing processes...')
  await sprite.execFile('bash', ['-c', 'pkill -9 bun 2>/dev/null || true; sleep 2'])

  // Start with exec (foreground but detached) and capture all output
  console.log('\nStarting server...')
  await sprite.execFile('bash', ['-c', `
    cd /app
    rm -f /app/server.log
    /app/start.sh > /app/server.log 2>&1 &
    SERVERPID=$!
    echo "Started PID: $SERVERPID"

    # Wait and check
    sleep 5

    # Check if still running
    if kill -0 $SERVERPID 2>/dev/null; then
      echo "Process still running"
    else
      echo "Process DIED"
      wait $SERVERPID
      echo "Exit code: $?"
    fi
  `])

  // Wait a bit more
  await new Promise(r => setTimeout(r, 3000))

  // Check everything
  console.log('\n=== PROCESSES ===')
  const procs = await sprite.execFile('bash', ['-c', 'ps aux | grep bun | grep -v grep || echo "no bun"'])
  console.log(procs.stdout)

  console.log('\n=== PORT 8080 ===')
  const port = await sprite.execFile('bash', ['-c', 'netstat -tlnp 2>&1 | grep 8080 || echo "nothing"'])
  console.log(port.stdout)

  console.log('\n=== SERVER LOG (FULL) ===')
  const logs = await sprite.execFile('bash', ['-c', 'cat /app/server.log'])
  console.log(logs.stdout)
  if (logs.stderr) console.log('STDERR:', logs.stderr)

  console.log('\n=== DMESG (last 10) ===')
  const dmesg = await sprite.execFile('bash', ['-c', 'dmesg 2>&1 | tail -10 || echo "no dmesg"'])
  console.log(dmesg.stdout)
}

debug().catch(console.error)
