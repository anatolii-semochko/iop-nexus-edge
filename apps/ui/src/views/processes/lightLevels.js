import { cilBrightness, cilCloud, cilCloudy, cilContrast, cilMoon, cilSun } from '@coreui/icons'

// The 6-level daylight classification `weather-control` derives from a raw
// light reading (Node Weather Control.txt, AGENTS_TO_DO.md 2026-08-23) -
// matches devices/standalone/sensor/light-level's own contract.schema.ts
// `enum` list exactly, ordered dark -> very-sunny (ascending raw value).
// Icons are the closest real matches available in @coreui/icons - no
// dedicated weather icon set exists there, so cilBrightness/cilContrast
// (generic UI icons, not literally sun/dusk glyphs) stand in for
// sunny/dusk.
export const LIGHT_LEVELS = [
  { key: 'dark', label: 'Dark', icon: cilMoon, defaultColor: '#212529' },
  { key: 'dusk', label: 'Dusk', icon: cilContrast, defaultColor: '#495057' },
  { key: 'overcast', label: 'Overcast', icon: cilCloud, defaultColor: '#868e96' },
  { key: 'medium', label: 'Medium', icon: cilCloudy, defaultColor: '#adb5bd' },
  { key: 'sunny', label: 'Sunny', icon: cilBrightness, defaultColor: '#ffca2c' },
  { key: 'very-sunny', label: 'Very sunny', icon: cilSun, defaultColor: '#fd7e14' },
]

// Raw light Device's declared range (weather-node/firmware/src/config.h's
// analogReadResolution(12) - a 0-4095 12-bit ADC count).
export const RAW_LIGHT_MIN = 0
export const RAW_LIGHT_MAX = 4095

export const LEVEL_BY_KEY = Object.fromEntries(LIGHT_LEVELS.map((level) => [level.key, level]))

// Default zone boundaries - a plausible even split across the raw range,
// meant to be retuned once real day/night readings are in hand (see
// weather-node's own wiring docs).
export const defaultZones = () =>
  LIGHT_LEVELS.map((level, index) => ({
    key: level.key,
    color: level.defaultColor,
    // First zone has no lower boundary of its own (implicitly RAW_LIGHT_MIN).
    min: index === 0 ? undefined : Math.round((RAW_LIGHT_MAX / LIGHT_LEVELS.length) * index),
  }))

// Which zone a raw value currently falls into - for the diagram's own
// marker/preview only, not the source of truth (the weather-control
// process computes this itself, server-side, every tick).
export const classifyRawLight = (zones, value) => {
  if (value === undefined || value === null) return null
  let current = zones[0]?.key ?? null
  for (const zone of zones) {
    if (zone.min === undefined || value >= zone.min) current = zone.key
  }
  return current
}
