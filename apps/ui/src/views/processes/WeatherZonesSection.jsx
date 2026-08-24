import React, { useState } from 'react'
import CIcon from '@coreui/icons-react'
import { CButton, CCol, CFormInput, CRow } from '@coreui/react'
import NumericStepper from '../devices/NumericStepper'
import {
  LIGHT_LEVELS,
  RAW_LIGHT_MAX,
  RAW_LIGHT_MIN,
  classifyRawLight,
  defaultZones,
} from './lightLevels'
import { useDeviceValue } from './useDeviceValue'

const percent = (value) => ((value - RAW_LIGHT_MIN) / (RAW_LIGHT_MAX - RAW_LIGHT_MIN)) * 100

// Valid [lower, upper] range for zones[index].min - must stay strictly
// between its two neighbors (the previous zone's own boundary, or
// RAW_LIGHT_MIN for the first real boundary; the next zone's boundary, or
// RAW_LIGHT_MAX for the last zone) - same "control against neighbor
// zones" the Ukrainian spec asked for ("контроль мін/макс значень
// залежно від сусідніх зон").
const boundaryRange = (zones, index) => {
  const lower = (zones[index - 1]?.min ?? RAW_LIGHT_MIN) + 1
  const upper = index + 1 < zones.length ? zones[index + 1].min - 1 : RAW_LIGHT_MAX
  return [lower, upper]
}

/**
 * "Light level zones" - the weather-control process kind's own Settings
 * popup section (Node Weather Control.txt's "Config процесу" block,
 * AGENTS_TO_DO.md 2026-08-23): a horizontal diagram of the 6 light-level
 * zones (dark -> very-sunny), a dashed marker at the raw light Device's
 * current value, one boundary editor per border between adjacent zones
 * (reusing NumericStepper - same "-'/'+'/disabled-input" component the
 * spec pointed at, used elsewhere for temperature thresholds), an
 * "accept current value" button per boundary, and a color picker per
 * zone.
 *
 * Staged locally exactly like AnnunciatorSlotsSection.jsx (both
 * registered into processTypeRegistry.js's own processSettingsSections)
 * - edits only reach
 * `process.config.zones` when the modal's own Save button runs, via
 * `extraConfigRef`; Cancel/close just discards this component's local
 * state.
 */
const WeatherZonesSection = ({ process, extraConfigRef }) => {
  const [zones, setZones] = useState(process.config.zones ?? defaultZones())
  const rawLight = useDeviceValue(process.config.lightDeviceId)
  const currentZoneKey = classifyRawLight(zones, rawLight)

  const updateZones = (next) => {
    setZones(next)
    extraConfigRef.current = next
  }

  const updateBoundary = (index, min) => {
    updateZones(zones.map((zone, i) => (i === index ? { ...zone, min } : zone)))
  }

  const updateColor = (index, color) => {
    updateZones(zones.map((zone, i) => (i === index ? { ...zone, color } : zone)))
  }

  const acceptCurrentValue = (index) => {
    if (rawLight === undefined || rawLight === null) return
    const [lower, upper] = boundaryRange(zones, index)
    updateBoundary(index, Math.min(upper, Math.max(lower, Math.round(rawLight))))
  }

  return (
    <div className="mb-3">
      <div className="text-body-secondary small mb-2">Light level zones</div>

      {/* Diagram - proportional colored segments across the raw light
          Device's own 0-4095 range, plus a dashed marker at its current
          value. */}
      <div
        className="d-flex position-relative mb-2"
        style={{
          height: '2.5rem',
          borderRadius: '0.25rem',
          overflow: 'hidden',
          border: '1px solid var(--cui-border-color)',
        }}
      >
        {zones.map((zone, index) => {
          const start = zone.min ?? RAW_LIGHT_MIN
          const end = index + 1 < zones.length ? zones[index + 1].min : RAW_LIGHT_MAX
          const level = LIGHT_LEVELS[index]
          return (
            <div
              key={zone.key}
              title={`${level.label}: ${start} - ${end}`}
              style={{
                flexBasis: `${percent(end) - percent(start)}%`,
                background: zone.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CIcon icon={level.icon} style={{ color: '#fff', opacity: 0.85 }} />
            </div>
          )
        })}
        {rawLight !== undefined && rawLight !== null && (
          <div
            title={`Current: ${rawLight}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${Math.min(100, Math.max(0, percent(rawLight)))}%`,
              borderLeft: '3px dashed #fff',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            }}
          />
        )}
      </div>
      <div className="text-body-secondary small mb-3">
        Current raw light value: {rawLight !== undefined && rawLight !== null ? rawLight : '-'}
        {currentZoneKey && ` (${LIGHT_LEVELS.find((l) => l.key === currentZoneKey)?.label})`}
      </div>

      {/* Per-zone color. */}
      {zones.map((zone, index) => (
        <CRow key={zone.key} className="align-items-center g-2 mb-1">
          <CCol xs="4">
            <div className="d-flex align-items-center gap-2">
              <CIcon icon={LIGHT_LEVELS[index].icon} />
              <span>{LIGHT_LEVELS[index].label}</span>
            </div>
          </CCol>
          <CCol xs="auto">
            <CFormInput
              type="color"
              size="sm"
              style={{ width: '3rem', padding: '0.15rem' }}
              value={zone.color}
              onChange={(e) => updateColor(index, e.target.value)}
            />
          </CCol>
        </CRow>
      ))}

      {/* One boundary editor per border between adjacent zones. */}
      <div className="text-body-secondary small mt-3 mb-2">Zone boundaries (raw light value)</div>
      {zones.slice(1).map((zone, i) => {
        const index = i + 1
        const [lower, upper] = boundaryRange(zones, index)
        return (
          <CRow key={zone.key} className="align-items-center g-2 mb-2">
            <CCol xs="5">
              <div className="text-body-secondary small">
                {LIGHT_LEVELS[index - 1].label} / {LIGHT_LEVELS[index].label}
              </div>
            </CCol>
            <CCol xs="auto">
              <NumericStepper
                value={zone.min}
                step={10}
                min={lower}
                max={upper}
                onCommit={(v) => updateBoundary(index, v)}
              />
            </CCol>
            <CCol xs="auto">
              <CButton
                size="sm"
                variant="outline"
                color="secondary"
                disabled={rawLight === undefined || rawLight === null}
                onClick={() => acceptCurrentValue(index)}
              >
                Accept current value
              </CButton>
            </CCol>
          </CRow>
        )
      })}
    </div>
  )
}

export default WeatherZonesSection
