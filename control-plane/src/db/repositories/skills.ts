import { eq, and, sql } from 'drizzle-orm'
import { db, agentSkills } from '../index'

export type AgentSkill = typeof agentSkills.$inferSelect

export async function getAgentSkills(agentId: string) {
  return db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId))
}

export async function getAgentSkill(agentId: string, skill: AgentSkill['skill']) {
  const rows = await db
    .select()
    .from(agentSkills)
    .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skill, skill)))
  return rows[0] ?? null
}

export async function addSkillXP(agentId: string, skill: AgentSkill['skill'], xp: number) {
  await db
    .update(agentSkills)
    .set({ xp: sql`${agentSkills.xp} + ${xp}` })
    .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skill, skill)))
}

export async function setSkillLevel(agentId: string, skill: AgentSkill['skill'], level: AgentSkill['level']) {
  await db
    .update(agentSkills)
    .set({ level })
    .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skill, skill)))
}
