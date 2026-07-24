// Package deviceservice is the NexusEdge custom EdgeX device-service. It
// hosts both the CAN bus transport and the Virtual Node Runtime, switching
// between them per device based on the device's EdgeX protocol properties
// (see AGENTS.md section 6).
package deviceservice

// Version is set at build time via -ldflags; "dev" is used for local,
// unversioned builds.
var Version string = "dev"
