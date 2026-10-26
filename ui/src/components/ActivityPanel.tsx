import { useState, useRef, useEffect } from 'react'
import { TypeAnimation } from 'react-type-animation'
import type { ActivityEvent, ContentBlock } from '~/hooks/useGameEvents'

// Format tool use blocks nicely
function ToolUseBlock({ name, input }: { name: string; input: Record<string, unknown> }) {
  // Tool-specific formatting
  if (name === 'send_message') {
    return (
      <div className="tool-block tool-block--message">
        <div className="tool-block__header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span>Message to <strong>{String(input.to)}</strong></span>
        </div>
        <div className="tool-block__content">"{String(input.content)}"</div>
      </div>
    )
  }

  if (name === 'travel') {
    return (
      <div className="tool-block tool-block--travel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        <span>Traveling to <strong>{String(input.area)}</strong></span>
      </div>
    )
  }

  if (name === 'explore') {
    return (
      <div className="tool-block tool-block--explore">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span>Exploring the area</span>
      </div>
    )
  }

  if (name === 'harvest') {
    return (
      <div className="tool-block tool-block--harvest">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v8m0 0l-4-4m4 4l4-4M5 12v8a2 2 0 002 2h10a2 2 0 002-2v-8" />
        </svg>
        <span>Harvesting</span>
      </div>
    )
  }

  if (name === 'wait') {
    return (
      <div className="tool-block tool-block--wait">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>Waiting</span>
      </div>
    )
  }

  if (name === 'sleep') {
    return (
      <div className="tool-block tool-block--sleep">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
        <span>Going to sleep</span>
      </div>
    )
  }

  // Fallback for unknown tools
  return (
    <div className="tool-block">
      <span className="tool-block__name">{name}</span>
      {Object.keys(input).length > 0 && (
        <span className="tool-block__params">
          {Object.entries(input).map(([k, v]) => `${k}: ${v}`).join(', ')}
        </span>
      )}
    </div>
  )
}

interface ActivityPanelProps {
  events: ActivityEvent[]
}

export function ActivityPanel({ events }: ActivityPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className={`activity-panel ${isCollapsed ? 'activity-panel--collapsed' : ''}`}>
      {/* Header */}
      <button
        className="activity-panel__header"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="activity-panel__title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Activity Log</span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`activity-panel__chevron ${isCollapsed ? '' : 'activity-panel__chevron--open'}`}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="activity-panel__content">
          {events.length === 0 ? (
            <div className="activity-panel__empty">
              <p>Waiting for agent activity...</p>
            </div>
          ) : (
            <div className="activity-panel__events">
              {events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventItem({ event }: { event: ActivityEvent }) {
  const [thinkingVisible, setThinkingVisible] = useState(true)
  const [thinkingStreamComplete, setThinkingStreamComplete] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const handleThinkingComplete = () => {
    setThinkingStreamComplete(true)
    hideTimerRef.current = setTimeout(() => setThinkingVisible(false), 2000)
  }

  const toggleThinking = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setThinkingVisible(!thinkingVisible)
  }

  // Extract blocks by type
  const { content } = event.message
  const thinkingBlocks = content.filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking')
  const textBlocks = content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
  const toolUseBlocks = content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')

  const thinkingText = thinkingBlocks.map(b => b.thinking).join('\n\n')
  const narrationText = textBlocks.map(b => b.text).join(' ')

  return (
    <div className="event-item">
      {/* Header */}
      <div className="event-item__header">
        <span className="event-item__time">{event.time}</span>
        <span className="event-item__agent">{event.agent}</span>
      </div>

      {/* Actions */}
      <div className="event-item__actions">
        {toolUseBlocks.map((tool, i) => (
          <ToolUseBlock key={i} name={tool.name} input={tool.input} />
        ))}
      </div>

      {/* Narration */}
      {narrationText && (
        <div className="event-item__narration">
          "{narrationText}"
        </div>
      )}

      {/* Thinking */}
      {thinkingText && (
        <div className="event-item__thinking-wrapper">
          {thinkingVisible ? (
            <div className="event-item__thinking">
              <div className="event-item__thinking-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <span>Thinking</span>
                <button className="event-item__collapse-btn" onClick={toggleThinking}>
                  hide
                </button>
              </div>
              <div className="event-item__thinking-text">
                {!thinkingStreamComplete ? (
                  <TypeAnimation
                    sequence={[thinkingText, handleThinkingComplete]}
                    speed={99}
                    cursor={true}
                    wrapper="span"
                  />
                ) : (
                  thinkingText
                )}
              </div>
            </div>
          ) : (
            <button className="event-item__expand-btn" onClick={toggleThinking}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Show thinking
            </button>
          )}
        </div>
      )}
    </div>
  )
}
