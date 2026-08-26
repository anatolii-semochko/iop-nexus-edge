// Shared footprint for every indicator in this folder (StatusIndicator,
// BuzzerIndicator) - same physical size regardless of which one is used
// where, matching the size the very first indicator (TemperatureProcessPanel's
// Cooler/Heater dots) already had before this became its own component.
export const INDICATOR_SIZE = 48

// Mini variant (AGENTS_TO_DO.md, 2026-08-02) - for panels with many
// indicators at once (Alarm Annunciator's 16 LEDs), where the full
// 48px/5px footprint above is too heavy repeated that many times.
export const MINI_INDICATOR_SIZE = 30
export const MINI_BORDER_WIDTH = 3
