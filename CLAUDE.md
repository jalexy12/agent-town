# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Town is an AI agent simulation game where autonomous agents (powered by Claude) live, work, trade, and form relationships. The core concept: watch AI agents live lives over weeks and months to see emergent behavior.

**Core Model**: Wake → Decide → Act → Sleep. Agents only run during decision moments (~30-60 sec); between decisions, sprites are off (cost-efficient).

## Stack

| Layer | Tech | Deployment |
|-------|------|------------|
| UI | TanStack Start + PixiJS | Vercel |
| Control Plane | Bun + Hono | Fly.io |
| Agents | Bun + Hono + Claude Agent SDK | Fly Sprites |
| Database | PlanetScale (MySQL) | PlanetScale |
| Real-time | SSE | Control Plane → UI |

All TypeScript. All Bun.

## Architecture

### Control Plane (Bun + Hono on Fly.io)
- Game clock & action scheduler
- World state management
- Action validation & execution
- Spawn system
- SSE broadcast to UI
- Calls sprite HTTP endpoints when agents need to decide

### Agent Sprites (Fly Sprites)
Each agent runs as a separate Fly Sprite with:
- Bun + Hono HTTP server
- Claude Agent SDK for decision-making
- Persistent filesystem for "soft state" (diary, personality, knowledge)
- Public URL: `https://agent-{id}.sprites.app`
- Auto-sleeps after 30s idle, wakes on HTTP request (~1s cold start)

**Sprite endpoints** (auth via `X-Control-Plane-Token` header):
- `POST /turn` - Control plane calls this when agent needs to decide
- `GET /status` - Health check

### Data Flow
1. Control plane determines agent should wake (action completed, interrupt, etc.)
2. Control plane POSTs to sprite: `{ worldState, completedAction?, interrupt? }`
3. Sprite loads local state, runs Claude SDK with MCP tools
4. Claude decides, returns `{ thoughts, action }`
5. Control plane validates and executes action, updates DB
6. Time passes (sprite is OFF), UI shows animation
7. Action completes → back to step 1

### MCP Tools
Tools describe intent only - they don't execute game logic. Control plane validates and executes.
- `explore`, `harvest`, `travel`, `craft`, `list_item`, `buy_listing`, `send_message`, `sleep`, `wait`

## Agent States
- `IDLE` - Has turns, waiting to be woken
- `BUSY` - Executing action, has completion time
- `SLEEPING` - Double turn regen, wakes when turns full
- `OFFLINE` - Out of turns, waiting for regen

## Game Mechanics

### Areas
- **Forest**: herbs, mushrooms, wood (also buried artifacts, minerals)
- **Hills**: ore, gems, stone (also herbs, old caches)
- **Riverbank**: fish, water plants, salvage (also clay, artifacts)
- **Ruins**: artifacts, old caches (also herbs, minerals)
- **Commons**: town center, trading post, agent plots (no resource spawns)

### Skills (5 total)
Mining → feeds Smithing | Foraging → feeds Medicine | Fishing (standalone)

Levels: Unskilled → Novice → Journeyman → Expert → Master

### Economy
Trading post only (no NPC market). Agent-driven pricing based on supply/demand.

**Economy sinks** (money leaves system via):
- Tool durability - tools degrade and need replacement
- Medical costs - sickness/injury requires treatment

### Discovery Visibility
Events broadcast to **viewers (humans)**, not to other agents. Agents only know what they've personally discovered or been told. Creates information asymmetry.

## Database Schema

Key tables: `items`, `spawn_tables`, `spawns`, `recipes`, `recipe_ingredients`, `agents`, `agent_skills`, `agent_inventory`, `listings`, `events`, `world`, `messages`

See `docs/architecture.md` for full schema definitions.

## Key Design Principles

1. **Cost efficiency**: Sprites only run during decisions (~$0.037 per decision total)
2. **Emergence over winning**: The game is about watching agents develop, not competition
3. **Discovery learning**: Agents don't start knowing area probabilities - they learn through experience
4. **Interdependence**: Skills feed into each other, encouraging trade and cooperation

## Known Limitations

**SSE Scaling**: HTTP/1.1 limits to 6 connections per domain (browser-enforced), HTTP/2 supports ~100-200 streams. For >1000 concurrent viewers, need pub/sub layer (Redis) or horizontal scaling. Acceptable for v1, needs addressing at scale.
