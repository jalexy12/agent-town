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

## Deployment & Operations

### Production URLs
- **Control Plane**: https://agent-town-control.fly.dev
- **UI**: https://ui-delta-vert.vercel.app
- **Sprites**: https://agent-town-{agentId}-etkf.sprites.app

### Deploy Commands
```bash
# Control plane (Fly.io) - causes ~5s restart
cd control-plane && ~/.fly/bin/flyctl deploy

# UI (Vercel) - zero downtime
cd ui && vercel --prod

# Sprites - NOT auto-updated by deploys
# Must use sprites:setup or manual hot-load
bun run sprites:setup
```

### Sprite Code Updates (CRITICAL)
Sprites are NOT updated when you deploy the control plane. They have baked-in code.

**Version coordination**: Both sprite and control plane track code versions:
- `sprite/src/index.ts`: `CODE_VERSION = '2026-01-16-v3'`
- `control-plane/src/index.ts`: `EXPECTED_CODE_VERSION = '2026-01-16-v3'`

**Safe hot-loading (PREFERRED):**
```bash
# 1. Edit sprite/src/index.ts (don't touch CODE_VERSION manually)
# 2. Run the update script - handles everything automatically:
bun run sprites:update
```

This script:
- Pauses scheduler (DB-backed, survives restarts)
- Auto-increments version
- Updates all 6 sprites in parallel
- Creates checkpoints before update (rollback possible)
- Verifies each sprite has new version
- Updates control plane version
- Deploys control plane
- Resumes scheduler

**Full reset (wipes state):**
```bash
bun run sprites:setup  # Reinstalls everything, wipes diary/turn history
```

### Common Issues & Fixes

**502 Bad Gateway from sprites**
- Cause: Scheduler calling sprites without waking them first
- Check: `wakeSprite()` must be called before HTTP fetch to sprite
- Fix: Ensure scheduler.ts imports and uses `wakeSprite` from index.ts

**Sprites not starting after hot-load**
- Cause: Manual code push broke something (syntax error, missing deps)
- Fix: Run `bun run sprites:setup` to reinstall everything clean
- Note: This wipes sprite soft state (diary, turn history)

**Duplicate scheduler runs**
- Cause: Multiple Fly machines running
- Fix: `~/.fly/bin/flyctl scale count 1 --yes -a agent-town-control`
- Prevention: Set `auto_stop_machines = "off"` in fly.toml

**CORS errors in browser**
- Cause: UI domain not in control plane CORS whitelist
- Fix: Add domain to `cors()` config in `control-plane/src/index.ts`

### Useful Debug Commands
```bash
# Tail control plane logs
~/.fly/bin/flyctl logs -a agent-town-control

# Check sprite status
bun run sprites:status

# Read sprite logs
bun run scripts/read-logs.ts <agentId>

# Scale Fly machines
~/.fly/bin/flyctl scale show -a agent-town-control
```

## Known Limitations

**SSE Scaling**: HTTP/1.1 limits to 6 connections per domain (browser-enforced), HTTP/2 supports ~100-200 streams. For >1000 concurrent viewers, need pub/sub layer (Redis) or horizontal scaling. Acceptable for v1, needs addressing at scale.
