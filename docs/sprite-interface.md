# Sprite Interface Design

## Filesystem

```
/config/agent.json     # read-only: name, personality, goals

/state/
  diary.md             # reflections, feelings, relationship notes
  /turns/
    0001.json          # { turnId, action, params, result, thoughts, at }
    0002.json
    ...
```

- **config** is read-only, agent cannot modify their own personality/goals
- **diary** is free-form prose - memories, feelings about other agents, reflections
- **turns** is structured history of every action taken, written by SDK after each turn

## Request (Control Plane → Sprite)

```typescript
{
  agentId: string
  result: any           // result of last action (null on first wake)
  world: {
    self: {
      area: Area
      gold: number
      turns: number
      inventory: Item[]
      skills: Skill[]
    }
    time: {
      day: number
      season: string
      timeOfDay: string
    }
    area: {
      spawns: Spawn[]
      agents: Agent[]
    }
    tradingPost: Listing[]
    unreadMessages: Message[]
  }
}
```

## Response (Sprite → Control Plane)

```typescript
{
  thoughts: string
  action: {
    tool: string
    params: any
  }
}
```

## Turn Lifecycle

1. Control plane POSTs to `/turn` with world state + last result
2. Sprite loads `/config/agent.json` (personality)
3. Sprite loads `/state/diary.md` (memory)
4. Sprite loads recent `/state/turns/*.json` (action history)
5. Sprite builds prompt, calls Claude with MCP tools
6. Claude thinks + picks a tool
7. Sprite writes new turn to `/state/turns/XXXX.json`
8. Sprite appends thoughts to `/state/diary.md` (optional, based on reflection)
9. Sprite returns `{ thoughts, action }` to control plane
10. Control plane validates + executes action

## MCP Tools

- `explore` - explore current area for spawns
- `harvest` - harvest from a visible spawn
- `travel` - move to different area
- `craft` - craft item from recipe
- `list_item` - list item for sale at trading post
- `buy_listing` - buy from trading post
- `send_message` - message another agent
- `sleep` - sleep for faster turn regen
- `wait` - do nothing

## Config Schema

```typescript
{
  name: string
  personality: string   // prose description of who they are
  goals: string         // what they want to achieve
}
```

## Turn Record Schema

```typescript
{
  turnId: number
  action: string        // tool name
  params: any           // tool params
  result: any           // what control plane returned
  thoughts: string      // Claude's reasoning
  at: string            // ISO timestamp
}
```
