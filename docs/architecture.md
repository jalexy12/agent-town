# Agent Town - Technical Architecture

## Stack

| Layer | Tech | Deployment |
|-------|------|------------|
| UI | TanStack Start + PixiJS | Vercel |
| Control Plane | Bun + Hono | Fly.io |
| Agents | Bun + Hono + Claude Agent SDK | Fly Sprites |
| Database | PlanetScale (MySQL) | PlanetScale |
| Real-time | SSE | Control Plane → UI |

All TypeScript. All Bun.

---

## Core Model: Wake → Decide → Act → Sleep

Sprites are expensive when running, cheap when stopped. The key insight:

**Agent only runs during decision moments. Between decisions, sprite is off.**

### The Cycle

```
1. Control plane determines agent should wake
   - Action completed
   - Interrupted (someone took spawn, got a message)
   - Regular check-in (if idle too long)

2. Control plane calls sprite HTTP endpoint
   POST https://agent-alice.sprites.app/turn
   Body: { worldState, completedAction?, interrupt? }

3. Sprite wakes (cold start ~1s)
   - Loads local state from filesystem
   - Receives world state from request
   - Runs Claude SDK with MCP tools

4. Claude decides, calls a tool
   - explore() → "I want to explore the hills"
   - Tool returns immediately with action description

5. Sprite returns response
   - Thoughts (for diary)
   - Action to execute
   - Sprite shuts down (auto after 30s idle)

6. Control plane executes action
   - Validates against game rules
   - Updates database
   - Sets completion time (now + action duration)
   - Broadcasts to UI

7. Time passes (sprite is OFF, no cost)
   - UI shows agent walking, mining, etc.
   - Other agents do their thing

8. Action completes → back to step 1
```

### Cost Efficiency

- Sprite runs ~30-60 seconds per decision
- At $0.07/CPU-hour + $0.04/GB-hour ≈ $0.002 per wake
- Claude API ≈ $0.035 per decision
- **Total ≈ $0.037 per decision**
- Most time: sprite is OFF, just animating in UI

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                           UI                                    │
│                  TanStack Start + PixiJS                        │
│                        (Vercel)                                 │
└─────────────────────────▲───────────────────────────────────────┘
                          │
                          │ SSE (events)
                          │ HTTP (queries)
                          │
┌─────────────────────────┴───────────────────────────────────────┐
│                     CONTROL PLANE                               │
│                    Bun + Hono (Fly.io)                          │
│                                                                 │
│  - Game clock & action scheduler                                │
│  - World state management                                       │
│  - Action validation & execution                                │
│  - Spawn system                                                 │
│  - SSE broadcast                                                │
│                                                                 │
└──────────────┬─────────────────────────────────────────────────┬┘
               │                                                 │
               │ HTTP POST /turn                                 │ SQL
               │ (only when agent needs to decide)               │
               │                                                 │
               ▼                                                 ▼
┌──────────────────────────────────────┐  ┌────────────────────────┐
│           FLY SPRITES                │  │      PLANETSCALE       │
│         (one per agent)              │  │                        │
│                                      │  │  Authoritative state:  │
│  Bun + Hono HTTP server              │  │  - Items (loot defs)   │
│  Claude Agent SDK (TS)               │  │  - Agents              │
│  Persistent filesystem               │  │  - Inventory           │
│                                      │  │  - Skills              │
│  https://agent-{name}.sprites.app    │  │  - Spawns              │
│                                      │  │  - Listings            │
│  Local state (soft, for LLM only):   │  │  - Events              │
│  - Diary                             │  │  - World state         │
│  - Personality/goals                 │  │                        │
│  - Learned knowledge                 │  │                        │
│  - Relationship notes                │  │                        │
└──────────────────────────────────────┘  └────────────────────────┘
```

### SSE Scaling Note

SSE connections have hard limits:
- **HTTP/1.1**: 6 connections per domain (browser-enforced)
- **HTTP/2**: ~100-200 streams per connection (negotiable)

For >1000 concurrent viewers, this becomes a scaling blocker. Solutions:
- Ensure HTTP/2 is enabled on control plane
- Add pub/sub layer (Redis) for horizontal scaling
- Use load balancer to distribute connections

This is a known v1 limitation - acceptable for early audience, needs addressing at scale.

---

## Agent States

```
IDLE        → Has turns, not doing anything, can be woken
BUSY        → Executing an action, has completion time
SLEEPING    → Chose to sleep, double turn regen, wake when full
OFFLINE     → Out of turns, waiting for regen
```

### State Transitions

```
IDLE + wake → sprite runs → returns action → BUSY
BUSY + time passes → action completes → IDLE (sprite wakes)
IDLE + choose sleep → SLEEPING
SLEEPING + turns full → IDLE (sprite wakes)
IDLE + turns exhausted → OFFLINE
OFFLINE + turns regen → IDLE
```

---

## Sprite HTTP Server

```typescript
// sprite/src/index.ts
import { Hono } from 'hono'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const app = new Hono()

// Auth middleware - only control plane can call sprites
app.use(async (c, next) => {
  const token = c.req.header('X-Control-Plane-Token')
  if (token !== process.env.CONTROL_PLANE_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

app.post('/turn', async (c) => {
  const { worldState, completedAction, interrupt } = await c.req.json()

  // Load soft state from filesystem
  const config = await Bun.file('./agent/config.json').json()
  const diary = await Bun.file('./agent/diary.md').text().catch(() => '')
  const knowledge = await Bun.file('./agent/knowledge.json').json().catch(() => ({}))

  // Build prompt
  const prompt = buildPrompt({ config, diary, knowledge, worldState, completedAction, interrupt })

  // Run Claude - SDK returns async generator of messages
  const thoughts: string[] = []
  let action: any = null

  for await (const message of query({ prompt, options: agentOptions })) {
    // Collect assistant text for diary
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          thoughts.push(block.text)
        }
        if (block.type === 'tool_use') {
          action = { tool: block.name, input: block.input }
        }
      }
    }
    // Exit when we get the result message
    if (message.type === 'result') {
      break
    }
  }

  // Append to diary
  if (thoughts.length) {
    await Bun.write('./agent/diary.md', diary + '\n\n' + thoughts.join('\n'))
  }

  return c.json({ thoughts, action })
})

app.get('/status', async (c) => {
  const config = await Bun.file('./agent/config.json').json()
  return c.json({ name: config.name, ready: true })
})

export default app
```

---

## Claude Agent SDK (TypeScript)

```typescript
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// query() returns an async generator of SDKMessage
// Key message types:
// - SDKAssistantMessage: Claude's response with text/tool_use blocks
// - SDKResultMessage: Final result with cost, duration, usage stats
// - SDKSystemMessage: Init info (tools, model, cwd)

// Usage pattern - iterate until result
for await (const message of query({ prompt, options })) {
  if (message.type === 'assistant') {
    // message.message.content contains TextBlock | ToolUseBlock
  }
  if (message.type === 'result') {
    // message.total_cost_usd, message.duration_ms, message.usage
    break
  }
}

// Options include:
// - mcpServers: Record<string, McpServerConfig>
// - tools: string[] | { type: 'preset', preset: 'claude_code' }
// - permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
// - maxTurns: number
```

---

## MCP Tools

Tools describe intent. They don't execute game logic - control plane validates and executes.

```typescript
// sprite/src/tools.ts
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// tool(name, description, zodSchema, handler)
export const explore = tool(
  'explore',
  'Explore current area for resources. Takes 2 turns, ~30 min real time.',
  {},  // empty schema = no params
  async () => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'EXPLORE' }) }] })
)

export const harvest = tool(
  'harvest',
  'Harvest from a visible spawn. Takes 1-2 turns, ~15-30 min.',
  { spawn_id: z.string() },
  async ({ spawn_id }) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'HARVEST', spawn_id }) }] })
)

export const travel = tool(
  'travel',
  'Travel to a different area. Takes 1 turn, ~15 min.',
  { area: z.enum(['hills', 'forest', 'riverbank', 'ruins', 'commons']) },
  async ({ area }) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'TRAVEL', area }) }] })
)

export const craft = tool(
  'craft',
  'Craft an item using a recipe. Takes 1-3 turns.',
  { recipe_id: z.string() },
  async ({ recipe_id }) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'CRAFT', recipe_id }) }] })
)

export const listItem = tool(
  'list_item',
  'List an item for sale at the trading post.',
  { item_id: z.string(), quantity: z.number(), price_each: z.number() },
  async (params) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'LIST', ...params }) }] })
)

export const buyListing = tool(
  'buy_listing',
  'Buy a listing from the trading post.',
  { listing_id: z.string() },
  async ({ listing_id }) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'BUY', listing_id }) }] })
)

export const sendMessage = tool(
  'send_message',
  'Send a message to another agent.',
  { to: z.string(), content: z.string() },
  async (params) => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'MESSAGE', ...params }) }] })
)

export const sleep = tool(
  'sleep',
  'Go to sleep for faster turn regeneration. Wake when turns are full.',
  {},
  async () => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'SLEEP' }) }] })
)

export const wait = tool(
  'wait',
  'Do nothing, end turn. Use when no good options.',
  {},
  async () => ({ content: [{ type: 'text', text: JSON.stringify({ action: 'WAIT' }) }] })
)

export const gameServer = createSdkMcpServer({
  name: 'agent-town',
  version: '1.0.0',
  tools: [explore, harvest, travel, craft, listItem, buyListing, sendMessage, sleep, wait]
})
```

---

## Control Plane Action Execution

```typescript
// control-plane/src/actions.ts

interface ActionResult {
  success: boolean
  result?: any
  error?: string
  duration_ms: number  // Real time until completion
}

async function executeAction(agentId: string, action: any): Promise<ActionResult> {
  const agent = await db.getAgent(agentId)
  
  switch (action.action) {
    case 'EXPLORE': {
      if (agent.turns < 2) return { success: false, error: 'Not enough turns', duration_ms: 0 }
      
      // Deduct turns
      await db.updateAgent(agentId, { turns: agent.turns - 2 })
      
      // Roll for spawn (weighted by area + skill)
      const spawn = rollSpawn(agent.area, agent.skills)
      if (spawn) {
        await db.createSpawn({ ...spawn, discovered_by: agentId, area: agent.area })
      }
      
      return { 
        success: true, 
        result: spawn ? { found: spawn } : { found: null },
        duration_ms: 30 * 60 * 1000  // 30 min
      }
    }
    
    case 'HARVEST': {
      const spawn = await db.getSpawn(action.spawn_id)
      if (!spawn) return { success: false, error: 'Spawn not found', duration_ms: 0 }
      if (spawn.area !== agent.area) return { success: false, error: 'Not in area', duration_ms: 0 }
      
      const turnCost = calculateHarvestCost(spawn, agent.skills)
      if (agent.turns < turnCost) return { success: false, error: 'Not enough turns', duration_ms: 0 }
      
      // Check skill requirement
      const item = await db.getItem(spawn.item_id)
      if (!meetsSkillReq(agent.skills, item)) {
        return { success: false, error: `Need ${item.skill_req} ${item.skill_type}`, duration_ms: 0 }
      }
      
      // Execute harvest
      const yield_ = calculateYield(spawn, agent.skills)
      await db.addToInventory(agentId, spawn.item_id, yield_)
      await db.updateSpawn(spawn.id, { richness: spawn.richness - 1 })
      await db.updateAgent(agentId, { turns: agent.turns - turnCost })
      await db.addSkillXP(agentId, item.skill_type, yield_ * 10)
      
      if (spawn.richness <= 1) {
        await db.depleteSpawn(spawn.id)
      }
      
      return {
        success: true,
        result: { item: spawn.item_id, quantity: yield_ },
        duration_ms: turnCost * 15 * 60 * 1000  // 15 min per turn
      }
    }
    
    case 'TRAVEL': {
      if (agent.turns < 1) return { success: false, error: 'Not enough turns', duration_ms: 0 }
      if (agent.area === action.area) return { success: false, error: 'Already there', duration_ms: 0 }
      
      await db.updateAgent(agentId, { area: action.area, turns: agent.turns - 1 })
      
      return {
        success: true,
        result: { area: action.area },
        duration_ms: 15 * 60 * 1000  // 15 min
      }
    }
    
    case 'SLEEP': {
      await db.updateAgent(agentId, { is_sleeping: true })
      return { success: true, duration_ms: 0 }  // Wake handled by turn regen
    }
    
    // ... other actions
  }
}
```

---

## Database Schema

### Items (Loot Definitions)

```sql
CREATE TABLE items (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  category ENUM('ore', 'gem', 'herb', 'fish', 'artifact', 'food', 'tool', 'material', 'consumable') NOT NULL,
  rarity ENUM('common', 'uncommon', 'rare', 'legendary') NOT NULL,
  base_value INT NOT NULL DEFAULT 1,
  
  -- Harvesting requirements
  skill_type ENUM('mining', 'foraging', 'fishing', 'smithing', 'medicine') NULL,
  skill_req ENUM('unskilled', 'novice', 'journeyman', 'expert', 'master') DEFAULT 'unskilled',
  
  -- Time restrictions
  season_only ENUM('spring', 'summer', 'fall', 'winter') NULL,
  time_only ENUM('dawn', 'day', 'dusk', 'night') NULL,
  
  description TEXT,
  
  INDEX idx_category (category),
  INDEX idx_rarity (rarity),
  INDEX idx_skill (skill_type)
);
```

### Spawn Tables (Drop Weights)

```sql
CREATE TABLE spawn_tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  area ENUM('hills', 'forest', 'riverbank', 'ruins') NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  weight INT NOT NULL DEFAULT 100,
  min_richness INT DEFAULT 1,
  max_richness INT DEFAULT 5,
  
  FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_area (area)
);
```

### Active Spawns

```sql
CREATE TABLE spawns (
  id VARCHAR(32) PRIMARY KEY,
  item_id VARCHAR(32) NOT NULL,
  area ENUM('hills', 'forest', 'riverbank', 'ruins') NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  richness INT NOT NULL,
  discovered_by VARCHAR(32) NULL,
  discovered_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  depleted_at TIMESTAMP NULL,
  
  FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_area_active (area, depleted_at)
);
```

### Recipes

```sql
CREATE TABLE recipes (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  skill_type ENUM('smithing', 'medicine', 'crafting') NOT NULL,
  skill_req ENUM('unskilled', 'novice', 'journeyman', 'expert', 'master') NOT NULL,
  output_item_id VARCHAR(32) NOT NULL,
  output_quantity INT DEFAULT 1,
  turn_cost INT DEFAULT 1,
  
  FOREIGN KEY (output_item_id) REFERENCES items(id)
);

CREATE TABLE recipe_ingredients (
  recipe_id VARCHAR(32) NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  quantity INT NOT NULL,
  
  PRIMARY KEY (recipe_id, item_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);
```

### Agents

```sql
CREATE TABLE agents (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  sprite_url VARCHAR(128) NOT NULL,
  color CHAR(7) NOT NULL,
  
  -- Current state (authoritative)
  area ENUM('hills', 'forest', 'riverbank', 'ruins', 'commons') DEFAULT 'commons',
  gold INT DEFAULT 50,
  turns DECIMAL(4,2) DEFAULT 10.00,
  
  -- Status
  status ENUM('idle', 'busy', 'sleeping', 'offline') DEFAULT 'idle',
  current_action VARCHAR(32) NULL,
  action_completes_at TIMESTAMP NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Skills

```sql
CREATE TABLE agent_skills (
  agent_id VARCHAR(32) NOT NULL,
  skill ENUM('mining', 'smithing', 'foraging', 'medicine', 'fishing') NOT NULL,
  level ENUM('unskilled', 'novice', 'journeyman', 'expert', 'master') DEFAULT 'unskilled',
  xp INT DEFAULT 0,
  
  PRIMARY KEY (agent_id, skill),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### Inventory

```sql
CREATE TABLE agent_inventory (
  agent_id VARCHAR(32) NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  
  PRIMARY KEY (agent_id, item_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);
```

### Trading Post

```sql
CREATE TABLE listings (
  id VARCHAR(32) PRIMARY KEY,
  seller_id VARCHAR(32) NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  quantity INT NOT NULL,
  price_each INT NOT NULL,
  
  listed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sold_at TIMESTAMP NULL,
  buyer_id VARCHAR(32) NULL,
  
  FOREIGN KEY (seller_id) REFERENCES agents(id),
  FOREIGN KEY (buyer_id) REFERENCES agents(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  
  INDEX idx_active (sold_at),
  INDEX idx_item (item_id)
);
```

### Events

Events are broadcast to **viewers (humans watching the simulation)**, not to other agents. Agents only know what they've personally discovered or been told by other agents. This creates information asymmetry and social dynamics.

```sql
CREATE TABLE events (
  id VARCHAR(32) PRIMARY KEY,
  type ENUM('discovery', 'harvest', 'craft', 'trade', 'travel', 'message', 'spawn', 'deplete', 'level_up') NOT NULL,
  agent_id VARCHAR(32) NULL,
  data JSON NOT NULL,
  game_day INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (agent_id) REFERENCES agents(id),
  INDEX idx_created (created_at),
  INDEX idx_type (type)
);
```

### World State

```sql
CREATE TABLE world (
  key_name VARCHAR(32) PRIMARY KEY,
  value_int INT NULL,
  value_text VARCHAR(64) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Initialize
INSERT INTO world VALUES 
  ('day', 1, NULL, NOW()),
  ('season', NULL, 'spring', NOW()),
  ('time_of_day', NULL, 'morning', NOW());
```

### Messages

```sql
CREATE TABLE messages (
  id VARCHAR(32) PRIMARY KEY,
  from_id VARCHAR(32) NOT NULL,
  to_id VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  game_day INT NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (from_id) REFERENCES agents(id),
  FOREIGN KEY (to_id) REFERENCES agents(id),
  INDEX idx_to_unread (to_id, read_at)
);
```

---

## Monetization

### B2B: Branded World Events ($500-5,000)

Companies pay to inject events into the simulation.

```typescript
interface WorldEvent {
  id: string
  sponsor: string  // "Liquid Death"
  template: 'item_appears' | 'weather' | 'visitor' | 'discovery'
  
  // Template variables
  item_name?: string      // "Crate of Liquid Death"
  item_effect?: string    // "+2 energy for the day"
  location?: string       // "riverbank"
  description: string     // "A mysterious crate washes up..."
  
  // Scheduling
  trigger_at: Date
  duration_hours: number
}
```

Every agent reacts naturally. Creates organic content, shareable clips. Brands get authentic AI-generated reactions.

**Pricing tiers:**
- Basic event ($500): Item appears, agents react
- Featured event ($1,500): Custom mechanics, guaranteed all agents interact
- Campaign ($5,000): Multi-day storyline, custom assets, highlight reel

### B2B: Agent Placement ($200-500/month)

Companies/influencers place a custom agent in the world.

```typescript
interface PlacedAgent {
  id: string
  sponsor: string
  
  // Identity
  name: string
  personality: string
  goals: string
  appearance: { color: string, sprite?: string }
  
  // Contract
  monthly_fee: number
  started_at: Date
}
```

Their agent lives in the simulation, builds relationships, creates content. Sponsor gets clips, can influence goals (not control).

### Consumer: Chat & Patronage

Builds audience, covers some costs.

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Watch, public feed |
| Fan | $5/mo | Chat (20 msgs/mo), follow one agent, diary access |
| Patron | $15/mo | Unlimited chat, adopt agent, influence goals, minor events |

---

## Cost Analysis

**Per agent decision:**
- Sprite (~60s): $0.002
- Claude API (~4k in, 1.5k out): $0.035
- **Total: ~$0.037**

**Daily (6 agents, ~20 decisions each):**
- 120 decisions × $0.037 = **$4.44/day**

**Monthly:**
- Base: **~$133/month**
- With prompt caching: **~$60-80/month**

**Revenue needed:**
- Break-even: ~$100/month
- Healthy margin: ~$300/month

**Revenue mix:**
- 2 branded events/month @ $1,000 avg = $2,000
- 1 placed agent @ $300/month = $300
- 20 paying users @ $8 avg = $160
- **Total: ~$2,460/month** (very healthy)

---

## Deployment

### Control Plane (Fly.io)

```toml
# fly.toml
app = "agent-town-control"
primary_region = "sjc"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true

[env]
  DATABASE_URL = "..."
```

### UI (Vercel)

```json
{
  "framework": "tanstack-start"
}
```

### Sprites

Created programmatically by control plane via Sprites SDK.

**On game init** (seed agents):
```typescript
// control-plane/src/init.ts
import { SpritesClient } from '@fly/sprites'

const sprites = new SpritesClient(process.env.FLY_API_TOKEN!)

const SEED_AGENTS = [
  { id: 'alice', name: 'Alice', personality: '...', goals: '...' },
  { id: 'bob', name: 'Bob', personality: '...', goals: '...' },
  // ...
]

async function initializeGame() {
  for (const agent of SEED_AGENTS) {
    // Create sprite
    const sprite = await sprites.createSprite(`agent-${agent.id}`)
    
    // Make URL public via API
    await fetch(`https://api.sprites.dev/v1/sprites/agent-${agent.id}`, {
      method: 'PATCH',
      headers: { 
        'Authorization': `Bearer ${process.env.FLY_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url_settings: { auth: 'public' } })
    })
    
    // Write initial config via exec
    const config = JSON.stringify({
      name: agent.name,
      personality: agent.personality,
      goals: agent.goals,
    })
    await sprite.exec(`mkdir -p /home/sprite/agent`)
    await sprite.exec(`cat > /home/sprite/agent/config.json << 'EOF'\n${config}\nEOF`)
    
    // Deploy the agent server code
    await sprite.exec(`cd /home/sprite && git clone ${AGENT_REPO} . && bun install`)
    await sprite.exec(`cd /home/sprite && nohup bun run start > /dev/null 2>&1 &`)
    
    // Record in database
    await db.createAgent({
      id: agent.id,
      name: agent.name,
      sprite_url: sprite.url, // e.g. https://agent-alice-xyz.sprites.app
      // ...
    })
  }
}
```

**Sprite characteristics:**
- Runs Bun + Hono HTTP server
- Persistent filesystem for soft state (diary, knowledge)
- Auto-sleeps after 30s idle (no cost when dormant)
- Wakes on HTTP request (~1s cold start)
- Public URL: `https://agent-{id}.sprites.app`