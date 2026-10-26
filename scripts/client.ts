/**
 * Sprites client wrapper
 *
 * Uses @fly/sprites SDK. The SDK provides:
 * - sprite.exec(command) - runs command through shell (pipes work)
 * - sprite.spawn(command, args) - direct execution with streaming
 * - sprite.createCheckpoint(comment) - returns streaming Response
 * - sprite.listCheckpoints() - returns Checkpoint[]
 * - sprite.restoreCheckpoint(id) - returns streaming Response
 */

import { SpritesClient } from '@fly/sprites'

export function getSpritesClient(): SpritesClient {
  const token = process.env.SPRITES_TOKEN
  if (!token) {
    throw new Error('SPRITES_TOKEN environment variable is required')
  }
  return new SpritesClient(token)
}

export function getSpriteName(agentId: string): string {
  return `agent-town-${agentId}`
}

/**
 * Consume a streaming checkpoint response and wait for completion
 */
export async function consumeCheckpointStream(response: Response): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // Optionally log progress: decoder.decode(value)
  }
}
