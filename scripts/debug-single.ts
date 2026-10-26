/**
 * Debug a single sprite startup
 */

import { config } from 'dotenv'
config({ path: './control-plane/.env' })

import { getSpritesClient, getSpriteName } from './client'
import pRetry from 'p-retry'

async function debug() {
  const client = getSpritesClient()
  const spriteName = getSpriteName('alice')

  console.log('Debugging Alice sprite...\n')

  const sprite = await client.getSprite(spriteName)

  // Wake
  await pRetry(() => sprite.exec('echo wake'), { retries: 3, minTimeout: 500 })

  // Kill everything
  console.log('1. Killing all bun processes...')
  await sprite.execFile('bash', ['-c', 'pkill -9 bun 2>/dev/null || true; sleep 2'])

  // Start with explicit stderr capture
  console.log('\n2. Starting server and capturing output...')
  // Don't use nohup - run in background and redirect both streams
  await sprite.execFile('bash', ['-c', `
    cd /app
    /app/start.sh > /app/server.log 2>&1 &
    sleep 1
    echo "started pid=$!"
  `])

  // Wait a bit more
  console.log('\n3. Waiting 8 seconds for full startup...')
  await new Promise(r => setTimeout(r, 8000))

  // Check process state
  console.log('\n4. Process state...')
  const procs = await sprite.execFile('bash', ['-c', `
    echo "=== ps aux ==="
    ps aux | grep bun | grep -v grep || echo "no bun processes"
    echo ""
    echo "=== pgrep bun ==="
    pgrep -a bun || echo "nothing"
  `])
  console.log(procs.stdout)

  // Check what's on port 8080
  console.log('\n5. Port 8080 status...')
  const port = await sprite.execFile('bash', ['-c', `
    echo "=== lsof -i:8080 ==="
    lsof -i:8080 2>&1 || echo "nothing on 8080"
    echo ""
    echo "=== netstat ==="
    netstat -tlnp 2>&1 | grep 8080 || echo "not found"
    echo ""
    echo "=== curl ==="
    curl -v http://localhost:8080/status 2>&1 || echo "connection failed"
  `])
  console.log(port.stdout)

  // Check ALL logs
  console.log('\n6. All logs...')
  const logs = await sprite.execFile('bash', ['-c', `
    echo "=== /app/server.log ==="
    cat /app/server.log 2>&1 || echo "no file"
    echo ""
    echo "=== dmesg | tail ==="
    dmesg 2>&1 | tail -20 || echo "no dmesg"
  `])
  console.log(logs.stdout)
}

debug().catch(console.error)
