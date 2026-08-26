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
  // Degrees Celsius sharing the same 0-100 y-axis as the three percentages
  // above - not strictly the same unit, but CPU/SoC temps stay well under
  // 100C in normal operation (this project's Raspberry Pi target throttles
  // around 80C), so the shared axis reads fine in practice without a
  // second scale. A sample missing `temp` (host with no readable thermal
  // zone) just draws as 0 on this line, same as any other undefined key
  // below.
  { key: 'temp', color: '#fd7e14', label: 'Temp' },
]

const clamp = (n) => Math.min(100, Math.max(0, n))

/**
 * The color/label key for the chart below - a separate component, not
 * folded into ResourceLevelsChart itself, so ResourceMonitorPanel can
 * place it *outside* the chart's own bordered box (above it) instead of
 * overlaid on top of the plotted lines, which is where it used to sit.
 * Renders in normal flow (no positioning of its own) - the caller decides
 * where it goes.
 */
export const ResourceLevelsChartLegend = () => (
  <div className="d-flex gap-3 small text-body-secondary">
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
)

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
 * sidestepping that circularity. The legend above it (ResourceLevelsChartLegend)
 * sits outside this box entirely now, in an ordinary flex-column sibling -
 * that's a separate concern from this sizing trick, not a threat to it.
 *
 * `backgroundColor` is a neutral fill (`--cui-tertiary-bg`, the same
 * variable this app's own `body` background already uses - AGENTS.md
 * section 12) rather than the transparent default, which otherwise let
 * whatever's behind the expanded row (the card's own white/dark surface)
 * show through with no visual separation from the bordered box around it.
 */
const ResourceLevelsChart = ({ history }) => {
  const n = history.length

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        border: '2px solid var(--cui-border-color)',
        borderRadius: '6px',
        backgroundColor: 'rgb(157 196 148 / 31%)',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
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
    </div>
  )
}

export default ResourceLevelsChart
