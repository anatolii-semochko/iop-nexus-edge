// device.type -> its own ui/control and ui/simulator component (AGENTS.md
// section 7). Built-in types (see builtinDeviceTypes.js) register through
// the exact same register* calls a target-project plugin would use -
// extension points design, AGENTS_TO_DO.md 2026-07-28 - no special-casing for
// "official" types.
//
// Plain objects, read via bracket access (deviceControls[type]) rather
// than a getter method - react-hooks/static-components flags a component
// obtained through a function call as "created during render", even when
// the call is a pure lookup. Bracket access on a plain object is the same
// shape the pre-registry static maps used, so it stays lint-clean.
export const deviceControls = {}
export const deviceSimulators = {}

export const deviceTypeRegistry = {
  registerControl(type, Component) {
    deviceControls[type] = Component
  },
  registerSimulator(type, Component) {
    deviceSimulators[type] = Component
  },
}
