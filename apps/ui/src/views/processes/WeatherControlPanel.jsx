import React from 'react'
import CIcon from '@coreui/icons-react'
import { CCol, CRow } from '@coreui/react'
import { LEVEL_BY_KEY } from './lightLevels'
import { useDeviceValue } from './useDeviceValue'

const Reading = ({ label, value, unit, decimals = 1 }) => (
  <CCol xs="auto">
    <div className="text-body-secondary small">{label}</div>
    <div style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1 }}>
      {value !== undefined && value !== null
        ? `${Number(value).toFixed(decimals)}${unit ?? ''}`
        : '-'}
    </div>
  </CCol>
)

/**
 * Expandable-row detail for the "weather-control" process kind
 * (Node Weather Control.txt, AGENTS_TO_DO.md 2026-08-23) - read-only
 * display of the outdoor station's five readings (four raw sensor
 * Devices plus the process's own computed light-level Device). No
 * thresholds to edit here - unlike ControlNodePanel/
 * TemperatureProcessPanel, this process has no warning/error bounds of
 * its own; its only configurable behavior (zone boundaries/colors) lives
 * in the process's own Settings popup (Config -> "Light level zones"),
 * matching the Ukrainian spec's own "Config процесу" placement, not this
 * expandable panel.
 *
 * This process kind's *runner* lives in a target project's own
 * plugins/weather-control/process.ts (not nexus-edge core) - same split
 * `control-node`/`ControlNodePanel.jsx` already established.
 */
const WeatherControlPanel = ({ process }) => {
  const {
    temperatureDeviceId,
    humidityDeviceId,
    pressureDeviceId,
    lightDeviceId,
    lightLevelDeviceId,
  } = process.config

  const temperature = useDeviceValue(temperatureDeviceId)
  const humidity = useDeviceValue(humidityDeviceId)
  const pressure = useDeviceValue(pressureDeviceId)
  const light = useDeviceValue(lightDeviceId)
  const lightLevel = useDeviceValue(lightLevelDeviceId)

  const level = typeof lightLevel === 'string' ? LEVEL_BY_KEY[lightLevel] : undefined

  return (
    <div className="pt-0 pb-3 px-2">
      <CRow className="align-items-center g-4">
        <Reading label="Temperature" value={temperature} unit="°C" />
        <Reading label="Humidity" value={humidity} unit="%RH" />
        <Reading label="Pressure" value={pressure} unit=" hPa" />
        <Reading label="Light (raw)" value={light} unit="" decimals={0} />
        <CCol xs="auto">
          <div className="text-body-secondary small">Light level</div>
          <div
            className="d-flex align-items-center gap-2"
            style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1 }}
          >
            {level ? (
              <>
                <CIcon icon={level.icon} size="lg" style={{ color: level.defaultColor }} />
                {level.label}
              </>
            ) : (
              '-'
            )}
          </div>
        </CCol>
      </CRow>
    </div>
  )
}

export default WeatherControlPanel
