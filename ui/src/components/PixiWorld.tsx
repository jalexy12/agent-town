import { useEffect, useState, useCallback, useRef } from 'react'
import { Application, extend, useApplication, useTick } from '@pixi/react'
import { Container, Graphics, Text, TextStyle } from 'pixi.js'

extend({ Container, Graphics, Text })

type Agent = {
  id: string
  name: string
  area: string
  status: string
  action: string
  turns: number
  gold: number
}

const TILE = 16
const MAP_W = 40
const MAP_H = 30

// Area centers and radii for organic blob shapes
const AREAS = {
  hills:     { cx: 20, cy: 4,  rx: 12, ry: 4  },
  forest:    { cx: 5,  cy: 15, rx: 5,  ry: 7  },
  riverbank: { cx: 35, cy: 15, rx: 5,  ry: 7  },
  ruins:     { cx: 20, cy: 26, rx: 12, ry: 4  },
  commons:   { cx: 20, cy: 15, rx: 10, ry: 7  },
}

// Plots around commons (in tiles)
const PLOTS = [
  { x: 11, y: 9 },
  { x: 26, y: 9 },
  { x: 11, y: 18 },
  { x: 26, y: 18 },
  { x: 18, y: 18 },
  { x: 18, y: 9 },
]

const COLORS = {
  bg: 0x1a2a1a,
  grass: 0x3a5a3a,
  hills: 0x6a5a4a,
  forest: 0x2a5a2a,
  forestDark: 0x2a4a2a,
  riverbank: 0x3a5a6a,
  water: 0x2a4a6a,
  ruins: 0x4a4a5a,
  commons: 0x4a4a4a,
  plot: 0x4a6a4a,
  plotBorder: 0x6a6a4a,
  path: 0x5a4a3a,
  wood: 0x5a4030,
  roof: 0x7a5040,
  roofTop: 0xaa8060,
  tree: 0x2a5a2a,
  treeLight: 0x3a6a3a,
  trunk: 0x3a2a1a,
  rock: 0x5a5a5a,
  pillar: 0x6a6a7a,
  amber: 0xefef7f,
}

function seededRandom(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

interface PixiWorldProps {
  agents: Agent[]
  selectedAgent: string | null
  onSelectAgent: (id: string | null) => void
}

export default function PixiWorld({ agents, selectedAgent, onSelectAgent }: PixiWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (containerRef.current) {
      setReady(true)
    }
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {ready && containerRef.current && (
        <Application background={COLORS.bg} resizeTo={containerRef.current} antialias>
          <WorldScene agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} />
        </Application>
      )}
    </div>
  )
}

function WorldScene({ agents, selectedAgent, onSelectAgent }: PixiWorldProps) {
  const { app } = useApplication()
  const [scale, setScale] = useState(2)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!app?.screen) return
    const updateSize = () => {
      if (!app.screen) return
      const worldW = MAP_W * TILE
      const worldH = MAP_H * TILE
      const newScale = Math.min(app.screen.width / worldW, app.screen.height / worldH) * 0.9
      setScale(newScale)
      setOffset({
        x: (app.screen.width - worldW * newScale) / 2,
        y: (app.screen.height - worldH * newScale) / 2,
      })
    }
    updateSize()
    app.renderer?.on('resize', updateSize)
    return () => { app.renderer?.off('resize', updateSize) }
  }, [app])

  return (
    <pixiContainer x={offset.x} y={offset.y} scale={scale}>
      <TerrainLayer />
      <PathLayer />
      <Decorations />
      <CommonsLayer />
      <Labels />
      {agents.map((agent, i) => (
        <AgentSprite
          key={agent.id}
          agent={agent}
          index={i}
          selected={selectedAgent === agent.id}
          onSelect={() => onSelectAgent(selectedAgent === agent.id ? null : agent.id)}
        />
      ))}
    </pixiContainer>
  )
}

function drawBlob(g: Graphics, cx: number, cy: number, rx: number, ry: number, color: number, alpha: number = 1, seed: number = 0) {
  const rand = seededRandom(seed || cx * 1000 + cy)
  const points: { x: number; y: number }[] = []
  const segments = 24

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const wobble = 0.85 + rand() * 0.3
    points.push({
      x: cx * TILE + Math.cos(angle) * rx * TILE * wobble,
      y: cy * TILE + Math.sin(angle) * ry * TILE * wobble,
    })
  }

  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    g.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
  }
  g.closePath()
  g.fill({ color, alpha })
}

function TerrainLayer() {
  const draw = useCallback((g: Graphics) => {
    g.clear()

    // Fill entire map with grass
    g.rect(0, 0, MAP_W * TILE, MAP_H * TILE)
    g.fill({ color: COLORS.grass })

    // Draw organic blob shapes for each area
    drawBlob(g, AREAS.hills.cx, AREAS.hills.cy, AREAS.hills.rx, AREAS.hills.ry, COLORS.hills, 0.9, 1)
    drawBlob(g, AREAS.forest.cx, AREAS.forest.cy, AREAS.forest.rx, AREAS.forest.ry, COLORS.forest, 0.95, 2)
    drawBlob(g, AREAS.riverbank.cx, AREAS.riverbank.cy, AREAS.riverbank.rx, AREAS.riverbank.ry, COLORS.riverbank, 0.9, 3)
    drawBlob(g, AREAS.ruins.cx, AREAS.ruins.cy, AREAS.ruins.rx, AREAS.ruins.ry, COLORS.ruins, 0.85, 4)
    drawBlob(g, AREAS.commons.cx, AREAS.commons.cy, AREAS.commons.rx, AREAS.commons.ry, COLORS.commons, 0.95, 5)

    // Water blob on right edge of riverbank
    drawBlob(g, 38, 15, 3, 6, COLORS.water, 0.9, 6)
  }, [])

  return <pixiGraphics draw={draw} />
}

function PathLayer() {
  const draw = useCallback((g: Graphics) => {
    g.clear()

    const commonsCx = AREAS.commons.cx * TILE
    const commonsCy = AREAS.commons.cy * TILE

    // Paths from each area to commons center
    const endpoints = [
      { x: AREAS.forest.cx * TILE, y: AREAS.forest.cy * TILE },
      { x: AREAS.hills.cx * TILE, y: AREAS.hills.cy * TILE },
      { x: AREAS.riverbank.cx * TILE, y: AREAS.riverbank.cy * TILE },
      { x: AREAS.ruins.cx * TILE, y: AREAS.ruins.cy * TILE },
    ]

    // Draw each path
    endpoints.forEach((point) => {
      g.setStrokeStyle({ width: 8, color: COLORS.path, alpha: 0.5, cap: 'round' })
      g.moveTo(commonsCx, commonsCy)
      g.lineTo(point.x, point.y)
      g.stroke()
    })

    // Paths from plots to trading post
    const tpX = AREAS.commons.cx * TILE
    const tpY = AREAS.commons.cy * TILE
    PLOTS.forEach((plot) => {
      const plotCx = (plot.x + 1.5) * TILE
      const plotCy = (plot.y + 1.5) * TILE
      g.setStrokeStyle({ width: 4, color: COLORS.path, alpha: 0.4, cap: 'round' })
      g.moveTo(plotCx, plotCy)
      g.lineTo(tpX, tpY)
      g.stroke()
    })
  }, [])

  return <pixiGraphics draw={draw} />
}

function Decorations() {
  const draw = useCallback((g: Graphics) => {
    g.clear()

    // Forest trees
    const forestTrees = [
      [2, 10], [4, 12], [6, 11], [3, 14], [7, 13], [2, 16], [5, 17], [4, 19], [6, 18], [3, 20],
    ]
    forestTrees.forEach(([x, y]) => drawTree(g, x * TILE, y * TILE))

    // Hills rocks
    const hillRocks = [
      [12, 2], [16, 3], [20, 2], [24, 3], [28, 2], [14, 5], [18, 4], [22, 5], [26, 4],
    ]
    hillRocks.forEach(([x, y]) => drawRock(g, x * TILE, y * TILE))

    // Ruins pillars
    const ruinPillars = [
      [12, 24], [16, 25], [20, 24], [24, 25], [28, 24], [14, 27], [22, 27], [26, 26],
    ]
    ruinPillars.forEach(([x, y]) => drawPillar(g, x * TILE, y * TILE))

    // Riverbank reeds
    const reeds = [
      [36, 10], [37, 12], [36, 14], [37, 16], [36, 18], [37, 20],
    ]
    reeds.forEach(([x, y]) => drawReed(g, x * TILE, y * TILE))
  }, [])

  return <pixiGraphics draw={draw} />
}

function drawTree(g: Graphics, x: number, y: number) {
  // Shadow
  g.ellipse(x + 8, y + 14, 5, 2)
  g.fill({ color: 0x000000, alpha: 0.2 })
  // Trunk
  g.rect(x + 5, y + 10, 6, 6)
  g.fill({ color: COLORS.trunk })
  // Canopy
  g.circle(x + 8, y + 7, 7)
  g.fill({ color: COLORS.tree })
  g.circle(x + 8, y + 4, 5)
  g.fill({ color: COLORS.treeLight })
}

function drawRock(g: Graphics, x: number, y: number) {
  g.ellipse(x + 8, y + 12, 5, 2)
  g.fill({ color: 0x000000, alpha: 0.2 })
  g.circle(x + 8, y + 8, 6)
  g.fill({ color: COLORS.rock })
  g.circle(x + 6, y + 6, 3)
  g.fill({ color: 0x6a6a6a })
}

function drawPillar(g: Graphics, x: number, y: number) {
  g.ellipse(x + 8, y + 16, 5, 2)
  g.fill({ color: 0x000000, alpha: 0.2 })
  g.rect(x + 4, y + 4, 8, 12)
  g.fill({ color: COLORS.pillar })
  g.rect(x + 5, y, 6, 5)
  g.fill({ color: 0x5a5a6a })
}

function drawReed(g: Graphics, x: number, y: number) {
  g.setStrokeStyle({ width: 2, color: 0x5a7a5a })
  g.moveTo(x + 8, y + 16)
  g.lineTo(x + 6, y + 4)
  g.stroke()
  g.ellipse(x + 5, y + 2, 3, 5)
  g.fill({ color: 0x4a3a2a })
}

function CommonsLayer() {
  const draw = useCallback((g: Graphics) => {
    g.clear()

    // Draw plots
    PLOTS.forEach((plot) => {
      // Plot background
      g.rect(plot.x * TILE, plot.y * TILE, 3 * TILE, 3 * TILE)
      g.fill({ color: COLORS.plot })
      // Plot border
      g.setStrokeStyle({ width: 1, color: COLORS.plotBorder, alpha: 0.6 })
      g.rect(plot.x * TILE, plot.y * TILE, 3 * TILE, 3 * TILE)
      g.stroke()

      // House on plot
      const hx = plot.x * TILE + 8
      const hy = plot.y * TILE + 8
      // House body
      g.rect(hx, hy + 10, TILE * 2, TILE * 1.5)
      g.fill({ color: COLORS.wood })
      // Roof
      g.moveTo(hx - 4, hy + 10)
      g.lineTo(hx + TILE, hy)
      g.lineTo(hx + TILE * 2 + 4, hy + 10)
      g.closePath()
      g.fill({ color: COLORS.roof })
    })

    // Trading post
    const tpX = AREAS.commons.cx * TILE
    const tpY = (AREAS.commons.cy - 1) * TILE

    // Building shadow
    g.ellipse(tpX, tpY + TILE * 2.5, TILE * 2, TILE * 0.5)
    g.fill({ color: 0x000000, alpha: 0.2 })

    // Building body
    g.rect(tpX - TILE * 1.5, tpY, TILE * 3, TILE * 2)
    g.fill({ color: COLORS.wood })

    // Roof
    g.moveTo(tpX - TILE * 1.5 - 6, tpY)
    g.lineTo(tpX, tpY - TILE * 1.2)
    g.lineTo(tpX + TILE * 1.5 + 6, tpY)
    g.closePath()
    g.fill({ color: COLORS.roof })

    // Roof peak
    g.moveTo(tpX - TILE * 0.4, tpY - TILE * 0.6)
    g.lineTo(tpX, tpY - TILE * 1.4)
    g.lineTo(tpX + TILE * 0.4, tpY - TILE * 0.6)
    g.closePath()
    g.fill({ color: COLORS.roofTop })

    // Door
    g.rect(tpX - 5, tpY + TILE * 0.6, 10, TILE * 1.4)
    g.fill({ color: 0x3a2a1a })

    // Windows
    g.rect(tpX - TILE * 1.2, tpY + TILE * 0.4, 8, 8)
    g.fill({ color: 0x3a5a7a })
    g.rect(tpX + TILE * 0.4, tpY + TILE * 0.4, 8, 8)
    g.fill({ color: 0x3a5a7a })
  }, [])

  return <pixiGraphics draw={draw} />
}

function Labels() {
  const style = new TextStyle({
    fontFamily: 'monospace',
    fontSize: 12,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 2 },
  })

  return (
    <>
      <pixiText text="HILLS" style={style} anchor={0.5} x={AREAS.hills.cx * TILE} y={(AREAS.hills.cy - 2) * TILE} alpha={0.6} />
      <pixiText text="FOREST" style={style} anchor={0.5} x={AREAS.forest.cx * TILE} y={(AREAS.forest.cy - 5) * TILE} alpha={0.6} />
      <pixiText text="RIVERBANK" style={style} anchor={0.5} x={AREAS.riverbank.cx * TILE} y={(AREAS.riverbank.cy - 5) * TILE} alpha={0.6} />
      <pixiText text="RUINS" style={style} anchor={0.5} x={AREAS.ruins.cx * TILE} y={(AREAS.ruins.cy - 2) * TILE} alpha={0.6} />
      <pixiText text="COMMONS" style={style} anchor={0.5} x={AREAS.commons.cx * TILE} y={(AREAS.commons.cy - 5) * TILE} alpha={0.6} />
      <pixiText
        text="TRADING POST"
        style={new TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: COLORS.amber, stroke: { color: 0x000000, width: 2 } })}
        anchor={0.5}
        x={AREAS.commons.cx * TILE}
        y={(AREAS.commons.cy + 2) * TILE}
      />
    </>
  )
}

// Calculate target position for an agent based on their area
function getAgentTargetPosition(agent: Agent, index: number): { x: number; y: number } {
  const area = AREAS[agent.area as keyof typeof AREAS]
  if (!area) {
    return { x: AREAS.commons.cx * TILE, y: AREAS.commons.cy * TILE }
  }

  if (agent.area === 'commons') {
    const offsets = [[-20, -30], [20, -30], [-30, 10], [30, 10], [0, 30], [0, -50]]
    const offset = offsets[index % offsets.length]
    return {
      x: AREAS.commons.cx * TILE + offset[0],
      y: AREAS.commons.cy * TILE + offset[1],
    }
  }

  const rand = seededRandom(agent.id.charCodeAt(0) * 100 + index)
  const angle = rand() * Math.PI * 2
  const dist = 0.3 + rand() * 0.4
  return {
    x: (area.cx + Math.cos(angle) * area.rx * dist) * TILE,
    y: (area.cy + Math.sin(angle) * area.ry * dist) * TILE,
  }
}

// Commons center - waypoint for all travel
const COMMONS_CENTER = { x: AREAS.commons.cx * TILE, y: AREAS.commons.cy * TILE }

function AgentSprite({
  agent,
  index,
  selected,
  onSelect,
}: {
  agent: Agent
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const finalTarget = getAgentTargetPosition(agent, index)

  // Track previous area to detect area changes
  const prevAreaRef = useRef(agent.area)
  const [pos, setPos] = useState({ x: finalTarget.x, y: finalTarget.y })
  const [waypoints, setWaypoints] = useState<{ x: number; y: number }[]>([])
  const [bobOffset, setBobOffset] = useState(0)

  // When area changes, create path through commons and area centers
  useEffect(() => {
    if (prevAreaRef.current !== agent.area) {
      const fromArea = prevAreaRef.current
      const toArea = agent.area
      const toAreaData = AREAS[toArea as keyof typeof AREAS]
      const toAreaCenter = toAreaData
        ? { x: toAreaData.cx * TILE, y: toAreaData.cy * TILE }
        : finalTarget

      // Build waypoints along the drawn paths
      if (fromArea === 'commons') {
        // Leaving commons: go to area center, then to final spot
        setWaypoints([toAreaCenter, finalTarget])
      } else if (toArea === 'commons') {
        // Going to commons: just go to final spot (already near center)
        setWaypoints([COMMONS_CENTER, finalTarget])
      } else {
        // Area to area: go through commons, then to area center, then final
        setWaypoints([COMMONS_CENTER, toAreaCenter, finalTarget])
      }

      prevAreaRef.current = agent.area
    }
  }, [agent.area, finalTarget])

  // Smoothly animate along waypoints
  useTick((ticker) => {
    const delta = ticker.deltaTime
    const speed = 2.5 // Pixels per frame

    setPos(prev => {
      // Get current waypoint target
      const currentTarget = waypoints.length > 0 ? waypoints[0] : finalTarget

      const dx = currentTarget.x - prev.x
      const dy = currentTarget.y - prev.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      // Reached waypoint - pop it and continue
      if (dist < 3) {
        if (waypoints.length > 0) {
          setWaypoints(w => w.slice(1))
        }
        return prev
      }

      // Move towards waypoint
      const moveX = (dx / dist) * speed * delta
      const moveY = (dy / dist) * speed * delta

      return {
        x: prev.x + moveX,
        y: prev.y + moveY,
      }
    })

    // Bobbing animation - only when busy AND not traveling
    const isMoving = waypoints.length > 0 || Math.sqrt(
      Math.pow(finalTarget.x - pos.x, 2) + Math.pow(finalTarget.y - pos.y, 2)
    ) > 3

    if (agent.status === 'busy' && !isMoving) {
      setBobOffset(prev => (prev + delta * 0.15) % (Math.PI * 2))
    } else {
      setBobOffset(0)
    }
  })

  // Check if currently traveling
  const isTraveling = waypoints.length > 0 || Math.sqrt(
    Math.pow(finalTarget.x - pos.x, 2) + Math.pow(finalTarget.y - pos.y, 2)
  ) > 3

  // Bobbing only when stationary and busy
  const yBob = (agent.status === 'busy' && !isTraveling) ? Math.sin(bobOffset) * 2 : 0

  const agentColor = getAgentColor(agent.id)

  const draw = useCallback((g: Graphics) => {
    g.clear()

    // Shadow
    g.ellipse(0, 8, 5, 2)
    g.fill({ color: 0x000000, alpha: 0.3 })

    // Body (simple rounded rect with agent color)
    g.roundRect(-4, -2, 8, 10, 2)
    g.fill({ color: agentColor })

    // Head (skin colored circle)
    g.circle(0, -5, 4)
    g.fill({ color: 0xeeddcc })

    // Eyes (simple dots)
    g.circle(-1.5, -5, 0.8)
    g.fill({ color: 0x222222 })
    g.circle(1.5, -5, 0.8)
    g.fill({ color: 0x222222 })

    // Status indicator
    const statusColor = agent.status === 'busy' ? 0xf59e0b : agent.status === 'idle' ? 0x22c55e : 0x6b7280
    g.circle(5, -8, 3)
    g.fill({ color: statusColor })
    g.setStrokeStyle({ width: 1, color: 0x000000 })
    g.circle(5, -8, 3)
    g.stroke()

    // Selection ring
    if (selected) {
      g.setStrokeStyle({ width: 2, color: COLORS.amber })
      g.circle(0, 0, 12)
      g.stroke()
    }
  }, [agentColor, agent.status, selected])

  const nameStyle = new TextStyle({
    fontFamily: 'monospace',
    fontSize: 8,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 2 },
  })

  return (
    <pixiContainer
      x={pos.x}
      y={pos.y + yBob}
      eventMode="static"
      cursor="pointer"
      onPointerTap={onSelect}
    >
      <pixiGraphics draw={draw} />
      <pixiText text={agent.name} style={nameStyle} anchor={0.5} y={14} />
      {isTraveling && (
        <pixiText
          text="..."
          style={new TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: 0xffffff })}
          anchor={0.5}
          y={-18}
        />
      )}
    </pixiContainer>
  )
}

function getAgentColor(id: string): number {
  const colors: Record<string, number> = {
    alice: 0x7fef7f,
    bob: 0x7f7fef,
    clara: 0xef7fef,
    dex: 0xefef7f,
    eva: 0xef7f7f,
    finn: 0x7fefef,
  }
  return colors[id] || 0x7fef7f
}
