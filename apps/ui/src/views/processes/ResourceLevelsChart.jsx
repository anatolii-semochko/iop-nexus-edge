import React from 'react'

// 1 sample/sec (ResourceMonitorPanel's own poll interval) * 60 = a rolling
// 1-minute window, exactly what was asked for - not a fixed time axis, just
// "the last MAX_SAMPLES readings we've actually received". Exported so
// ResourceMonitorPanel trims its history buffer to the same length this
// chart actually renders, rather than duplicating the number.
export const MAX_SAMPLES = 60
const STEP = 100 / (MAX_SAMPLES - 1)

const SERIES = [
  { key: 'cpu', color: '#0d6efd', label: 'CPU' },
  { key: 'ram', color: '#6f42c1', label: 'RAM' },
  { key: 'disk', color: '#20c997', label: 'Disk' },
]

const clamp = (n) => Math.min(100, Math.max(0, n))

/**
 * Rolling 1-minute CPU/RAM/Disk line chart for ResourceMonitorPanel - a
 * plain hand-rolled SVG polyline, not a charting dependency (same "Node
 * built-ins over a library" call already made for the metrics themselves,
 * AGENTS.md section 21). `history` is a plain array of up to MAX_SAMPLES
 * `{cpu, ram, disk}` samples, oldest first.
 *
 * The newest sample always pins to the chart's right edge; while fewer
 * than MAX_SAMPLES have arrived yet (the panel was just expanded), the
 * line only occupies the right portion of the width and fills in leftward
 * over the panel's first minute open, rather than stretching a handful of
 * points across the full width and looking misleadingly zoomed out.
 *
 * viewBox + preserveAspectRatio="none" + width/height 100% makes this size
 * itself to whatever box it's rendered into (here, stretched to the height
 * of ResourceMonitorPanel's three metric rows via flexbox) with no manual
 * measuring - vectorEffect="non-scaling-stroke" keeps the line thickness
 * constant on screen despite that non-uniform scaling.
 *
 * This wrapper is `position: absolute; inset: 0` against its parent (which
 * must be `position: relative` - ResourceMonitorPanel's `flex-grow-1`
 * column), not `height: 100%` in normal flow: that column has no content
 * of its own to give it a height, so a plain `height: 100%` here would be
 * circular (this chart is the only reason the column has any size at all)
 * and the SVG would fall back to its own intrinsic/viewBox aspect ratio -
 * applied to the (correctly resolved) width, that rendered as a huge
 * square blowing out well past the panel. Absolute positioning resolves
 * against the flex item's already-stretched box in a later layout pass,
 * sidestepping that circularity.
 */
const ResourceLevelsChart = ({ history }) => {
  const n = history.length

  return (
    <div style={{ position: 'absolute', inset: 0, border: '2px solid var(--cui-border-color)' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        {SERIES.map(({ key, color }) => {
          if (n === 0) return null
          const points = history
            .map((sample, i) => {
              const x = 100 - (n - 1 - i) * STEP
              const y = 100 - clamp(sample[key] ?? 0)
              return `${x},${y}`
            })
            .join(' ')
          return (
            <polyline
              key={key}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      <div
        className="d-flex gap-3 position-absolute top-0 start-0 small text-body-secondary"
        style={{ pointerEvents: 'none' }}
      >
        {SERIES.map(({ key, color, label }) => (
          <span key={key} className="d-flex align-items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color,
                display: 'inline-block',
              }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default ResourceLevelsChart
