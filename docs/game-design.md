# Agent Town - Game Design

## The Point

Watch AI agents live lives. Check in after a week, a month, six months. See who they've become, what they've built, who they love and hate.

Not about winning. About emergence.

---

# ABOVE THE LINE (MVP)

---

## Scope

- **Agents**: 6-8
- **Skills**: 5
- **Areas**: 4-5 explorable regions
- **Economy**: Trading post only

---

## Turns & Time

### Core Model: Wake → Decide → Act → Sleep

Agents don't run continuously. They wake up, make a decision, start an action, then go dormant until the action completes.

```
1. Agent wakes (triggered by control plane)
2. Claude sees world state, decides what to do
3. Calls a tool (explore, harvest, travel, etc.)
4. Action starts, agent goes dormant
5. Real time passes (agent is "doing the thing")
6. Action completes → back to step 1
```

### Why This Model

- **Cost efficient**: AI only runs during decisions (~30-60 sec)
- **Always something happening**: Agents visibly doing stuff between decisions
- **Natural pacing**: Actions take real time, creates rhythm

### Turns

Cap at **10 turns**. Regen rate:
- Awake: 1 turn per 1.5 hours
- Sleeping: 2 turns per 1.5 hours (agent can choose to sleep)

### Action Costs & Durations

| Action | Turns | Real Time |
|--------|-------|-----------|
| Explore | 2 | 30 min |
| Harvest | 1-2 | 15-30 min |
| Travel | 1 | 15 min |
| Craft | 1-3 | 15-45 min |
| Trade | 1 | instant |
| Message | 0 | instant |
| Sleep | 0 | until turns full |

### Agent States

- **IDLE**: Has turns, waiting to be woken
- **BUSY**: Executing action, has completion time
- **SLEEPING**: Double regen, wakes when turns full
- **OFFLINE**: Out of turns, waiting for regen

### Interrupts

Agents can wake early if:
- Someone depletes a spawn they're currently harvesting
- They receive a message
- A world event affects them
- Their action fails mid-way

---

## The World

### Areas

Regions to explore. Different terrain, different vibes. **Spawns can appear in any area** - some areas just have higher probability for certain types. Agents don't know the probabilities up front. They learn through exploration.

**The Forest**
- Dense, overgrown
- *Tends toward*: herbs, mushrooms, wood
- *But also*: buried artifacts, animal dens, mineral deposits

**The Hills**
- Rocky, elevated terrain
- *Tends toward*: ore, gems, stone
- *But also*: herbs in crevices, old caches, occasional stream

**The Riverbank**
- Water access, muddy shores
- *Tends toward*: fish, water plants, salvage
- *But also*: herbs along banks, clay deposits, washed-up artifacts

**The Ruins**
- Crumbling structures, mysterious
- *Tends toward*: artifacts, old caches, strange items
- *But also*: overgrown herbs, exposed minerals, nesting spots

**The Commons**
- Town center, trading post, plots
- No resource spawns - this is civilization

### Plots

Each agent has a home plot around the commons. Storage, rest, crafting.

---

## Exploration & Spawns

**Exploring is how you find resources.** You don't know what's there until you look.

### How It Works

1. Agent spends 2 turns to explore an area
2. Roll for what spawns (weighted by area, modified by skill)
3. Result: nothing, common spawn, uncommon spawn, rare spawn
4. Agent sees what they found (or didn't)
5. Can harvest, leave, tell someone, or guard it

### Discovery Learning

Agents don't start knowing which areas have what. They learn through experience.

After exploring the hills 10 times and finding ore 7 times, an agent starts to understand the probabilities. This knowledge is theirs - they can share it, trade it, or keep it secret.

First-mover advantage: early explorers learn the world. Latecomers have to discover it themselves or get information from others.

### Spawn Properties

- **Type**: What it is (ore vein, herb patch, fishing spot, artifact)
- **Richness**: How much you can extract before depletion
- **Duration**: How long until it disappears naturally
- **Visibility**: Some obvious on discovery, some require skill to notice

### Discovery Events

Finding something notable creates an event visible to **viewers watching the simulation**, not to other agents:

> "Ben discovered a Silver Vein in the hills."

Other agents don't automatically know. Ben can:
- Keep it secret and harvest it himself
- Tell specific agents (creating social dynamics)
- Broadcast it publicly (if he wants help or competition)

This creates information asymmetry - early explorers have knowledge advantages they can trade or protect.

### Depletion & Respawn

Spawns run out. A rich vein might support 5-10 harvests. Then it's gone. 

New spawns appear over time, randomly across all areas. The world is always changing.

### Skill Affects Exploration

Higher skill in a relevant area:
- Better chance to find related spawns anywhere
- More likely to find rare versions
- Can see hidden spawns others miss
- More efficient harvesting (more yield, fewer turns)

---

## Skills

Five skills. Can't master all. Specialize.

### Progression

- **Unskilled**: Can attempt, mostly fail, waste turns
- **Novice**: Starting to work, inefficient
- **Journeyman**: Reliable, average results
- **Expert**: Good results, efficiency, rare access
- **Master**: Best results, unique finds, can teach

**Leveling**: Do the thing → get better. Costs turns. Slow.

### The Five Skills

**Mining**
- Find and extract ore, gems, stone
- Higher skill = find better veins, extract more
- Feeds into: smithing
- Output: ore, coal, gems, rare minerals

**Smithing**
- Turn ore into tools and metal goods
- Higher skill = better quality items
- Needs: ore, coal, gems
- Output: tools, equipment, jewelry

**Foraging**
- Find herbs, plants, materials
- Higher skill = find rare herbs, avoid poison
- Feeds into: medicine
- Output: herbs, mushrooms, materials, rare plants

**Medicine**
- Turn herbs into remedies and cures
- Higher skill = better potions, cure worse conditions
- Needs: herbs, rare plants
- Output: healing items, cures, buffs

**Fishing**
- Find and work fishing spots
- Higher skill = better catches, rare fish
- Standalone value, trades well
- Output: fish (food), rare catches, occasional salvage

### Interdependence

- Miners need smiths to make their ore valuable
- Smiths need miners for materials
- Foragers need medicine-makers (or sell raw herbs)
- Medicine-makers need foragers for inputs
- Everyone needs tools (smithing)
- Everyone eventually needs medicine
- Fishers are independent but want tools and medicine too

---

## Drops & Items

### Drop Rarity

- **Common**: Frequently found, low value
- **Uncommon**: Sometimes, moderate value
- **Rare**: Lucky find, high value
- **Legendary**: Exceptional, stories attached

### Item Categories

**Raw Materials**
- Ore, herbs, fish, wood, stone
- Inputs for crafting
- Some value as-is, more if processed

**Tools**
- Pickaxe, fishing rod, gathering tools
- Quality affects efficiency
- Wear out over time

**Consumables**
- Food items, potions, remedies
- One-time use
- Buffs, healing, curing

**Valuables**
- Gems, rare artifacts, quality goods
- Trade value
- Status

---

## Economy

### Trading Post Only

No NPC market. Agent-driven.

**Listing**: Post item with asking price
**Buying**: Pay listed price or negotiate
**Negotiation**: Counter-offer, haggle, bundle deals

Prices float based on supply/demand. If everyone's fishing and nobody's mining, ore gets expensive.

### Money

Earned from:
- Work (baseline: spend turns, get money, boring but safe)
- Selling items at trading post
- Direct trades

Spent on:
- Buying from trading post
- Services from other agents

### Economy Sinks

Money leaves the system through:

**Tool Durability**
- Tools degrade with use (quality drops over time)
- Broken tools must be replaced (gold to NPC shop or agent smith)
- Higher quality tools last longer but cost more

**Medical Costs**
- Sickness requires medicine (crafted by other agents or bought)
- Untreated sickness worsens, eventually requiring expensive cures
- Injury from dangerous areas (hills, ruins) needs treatment

**Plot Maintenance** (future consideration)
- Rent or upkeep costs could add recurring sink

---

## Problems

Things that create pressure.

**Sickness**
- Happens randomly
- Reduces effectiveness
- Needs medicine to cure
- Untreated = gets worse

**Injury**
- From dangerous exploration (hills, ruins)
- Can't do certain activities
- Heals slowly or needs treatment

**Tool Breakage**
- Tools wear out with use
- Broken tool = can't do that activity well
- Need smith to repair/replace

**Bad Luck**
- Explore and find nothing
- Spawn depletes before you harvest
- Someone else got there first

---

## Relationships

Emerge from interaction.

**Positive**
- Fair trades
- Helped when needed
- Taught a skill
- Gave a gift

**Negative**
- Ripped off in trade
- Refused to help
- Took a spawn I found
- Broke a promise

Relationships affect who agents choose to deal with, help, trust.

---

## Time

### Real Time

1 real day = 1 game day. The simulation runs continuously.

### Seasons

30 real days = 1 season. 4 seasons = 1 year.

- **Spring**: Renewal, new spawns more frequent
- **Summer**: Abundance, best yields
- **Fall**: Preparation, certain resources peak (salmon run, autumn herbs)
- **Winter**: Scarcity, fewer spawns, harsher conditions

### Time of Day

Affects some spawns:
- **Dawn** (5-7am): Morning dew herbs, early fish
- **Day**: Normal spawns
- **Dusk** (5-7pm): Evening catches
- **Night** (8pm-5am): Moonpetal, night mushrooms, catfish

### Spawns Appear Throughout Day

4-6 new resources spawn per day across all areas. Creates ongoing activity and competition.

---

## Starting State

- 6 agents
- Each has a plot
- Each starts unskilled
- Each has starting money and basic tools
- Each has personality and goals (we define these)
- World starts with some initial spawns scattered around

---

## Monetization

### B2B: Branded World Events ($500-5,000)

Companies pay to inject events into the simulation. Every agent reacts naturally. Creates organic content, shareable clips.

**Examples:**
- "A crate of [Brand] washes up on the riverbank. Agents who consume it get +2 energy."
- "A [Brand] merchant arrives in town for 3 days with special goods."
- "A [Brand]-sponsored festival: agents compete for prizes."

**Pricing:**
- Basic event ($500): Item appears, agents react
- Featured event ($1,500): Custom mechanics, all agents interact
- Campaign ($5,000): Multi-day storyline, custom assets, highlight reel

### B2B: Agent Placement ($200-500/month)

Companies/influencers place a custom agent in the world.

- Define personality, goals, appearance
- Agent lives in simulation, builds relationships
- Sponsor gets clips of their character
- Can influence goals (suggest, not control)

**Use cases:**
- Brand mascot that actually lives and has opinions
- Streamer's persona as an autonomous character
- Company representative that interacts with the community

### Consumer: Chat & Patronage

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Watch, public feed |
| Fan | $5/mo | Chat with agents (20/mo), follow one agent, diary access |
| Patron | $15/mo | Unlimited chat, adopt agent, influence goals, spawn minor events |

### Revenue Model

**Costs:**
- ~$100-150/month for API + infrastructure

**Revenue targets:**
- 2 branded events/month @ $1,000 avg = $2,000
- 1-2 placed agents @ $300/month = $300-600
- 20+ paying users @ $8 avg = $160+
- **Healthy margin at low volume**

---

# BELOW THE LINE (Later)

---

## Deferred Features

**Market (NPC shop)**
- Fixed prices for basics
- Safety net economy
- Add when trading post feels thin

**Crafting Skill**
- Make furniture, clothes, containers
- Comfort and trade goods
- Add when core loop works

**Husbandry Skill**
- Animals, breeding, ongoing yields
- Add for more economic depth

**Death**
- Permanent agent death
- Plot freed, stuff left behind
- Add when stakes feel too low

**Buildings & Plot Upgrades**
- Workshops, storage, improvements
- Add when agents need more progression

**Events (System-Generated)**
- Weather disasters
- Disease outbreaks
- Random visitors
- Add for drama injection (beyond paid branded events)

**Reputation System**
- Town-wide knowledge
- Affects strangers' behavior
- Add when relationships need more weight

**Teaching**
- Masters teach novices
- Faster skill gain
- Add when skill progression matters more

**Player Chat**
- Users can message agents directly
- Agents respond in character
- Part of monetization but needs careful design

---

## Open Questions (Resolve as we build)

1. Exact spawn rates and distribution per area
2. Tool durability - do we need it for MVP?
3. Skill XP curve (how many harvests to level up?)
4. Starting gold amount
5. How often sickness/injury? (maybe defer entirely)
6. Season effects specifically - how harsh is winter?
7. Can agents lie about what they found?
8. Combat/theft? (probably not v1)
9. How does user chat work? (interrupt agent? queue for next wake?)
10. What happens when agent is busy and receives interrupt?