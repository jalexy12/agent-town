import { eq } from 'drizzle-orm'
import { db } from '../index'
import { sessions } from '../schema'

export interface SessionData {
  sessionId: string
  messages: unknown[]
  pendingToolUseId: string | null
  actionCount: number
  startedAt: string
}

export async function getSession(agentId: string): Promise<SessionData | null> {
  const rows = await db.select().from(sessions).where(eq(sessions.agentId, agentId))
  if (rows.length === 0) return null

  const row = rows[0]
  return {
    sessionId: row.sessionId,
    messages: row.messages as unknown[],
    pendingToolUseId: row.pendingToolUseId,
    actionCount: row.actionCount ?? 0,
    startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
  }
}

export async function saveSession(agentId: string, session: SessionData): Promise<void> {
  await db.insert(sessions).values({
    agentId,
    sessionId: session.sessionId,
    messages: session.messages,
    pendingToolUseId: session.pendingToolUseId,
    actionCount: session.actionCount,
    startedAt: new Date(session.startedAt),
  }).onDuplicateKeyUpdate({
    set: {
      sessionId: session.sessionId,
      messages: session.messages,
      pendingToolUseId: session.pendingToolUseId,
      actionCount: session.actionCount,
      startedAt: new Date(session.startedAt),
    },
  })
}

export async function clearSession(agentId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.agentId, agentId))
}
