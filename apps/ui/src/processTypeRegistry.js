// process.kind -> its own expandable detail Panel (ProcessesTable.jsx)
// and/or Settings-popup extra section + config field
// (ProcessSettingsModal.jsx) - same registry idiom deviceTypeRegistry.js
// already uses for device types (AGENTS.md section 31). Built-in kinds
// register through the exact same calls a private plugin would - no
// special-casing "official" vs "private" anywhere below, see
// builtinProcessTypes.js for every CORE registration.
//
// Plain objects, read via bracket access - same react-hooks/static-
// components reasoning deviceTypeRegistry.js's own comment already
// documents (a component obtained through a function call reads as
// "created during render" to that lint rule, even when the call is a
// pure lookup).
export const processPanels = {}
export const processSettingsSections = {}
// Which process.config field each processSettingsSections entry stages
// its edits into (ProcessSettingsModal.jsx's own handleSave reads this
// back) - '*' means "spread the whole staged object into the PATCH body"
// instead of nesting it under one key (see a multi-field settings
// section's own comment for why that sentinel exists).
export const processSettingsConfigFields = {}

export const processTypeRegistry = {
  registerPanel(kind, Component) {
    processPanels[kind] = Component
  },
  registerSettingsSection(kind, Component, configField) {
    processSettingsSections[kind] = Component
    processSettingsConfigFields[kind] = configField
  },
}
