// Package virtual is the generic Virtual Node Runtime engine: it holds the
// in-memory state of every device currently switched to "virtual" backend
// (see AGENTS.md section 6) and answers read/write commands for it.
//
// DeviceRuntime is the extension point. The default implementation here
// (stateStore) is a plain get/set map with no simulated behavior beyond
// echoing back whatever was last written or seeded - enough to prove the
// physical/virtual switch end-to-end before any concrete device type
// exists. Once a real device type is defined under
// devices/nodes/<node-type>/devices/<device-type>/runtime/ (AGENTS.md
// section 7), its richer simulation (e.g. a temperature drifting toward a
// setpoint) is registered here via Register instead of relying on the
// default.
package virtual

import (
	"fmt"
	"sync"
)

// DeviceRuntime is the simulated behavior of a single virtual device.
type DeviceRuntime interface {
	Read(resource string) (any, error)
	Write(resource string, value any) error
}

// Runtime is the registry of DeviceRuntime instances, keyed by device name.
type Runtime struct {
	mu       sync.RWMutex
	runtimes map[string]DeviceRuntime
}

// NewRuntime creates an empty Virtual Node Runtime registry.
func NewRuntime() *Runtime {
	return &Runtime{runtimes: make(map[string]DeviceRuntime)}
}

// EnsureDefault registers a default in-memory state store for deviceName if
// no runtime is registered for it yet, seeded with initial. It is a no-op
// if a runtime (default or custom) already exists for the device.
func (r *Runtime) EnsureDefault(deviceName string, initial map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.runtimes[deviceName]; ok {
		return
	}
	r.runtimes[deviceName] = newStateStore(initial)
}

// Register installs a custom DeviceRuntime for deviceName, replacing any
// existing one (default or custom).
func (r *Runtime) Register(deviceName string, dr DeviceRuntime) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runtimes[deviceName] = dr
}

// Remove drops the runtime for deviceName, e.g. when the device is removed
// from EdgeX.
func (r *Runtime) Remove(deviceName string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.runtimes, deviceName)
}

// Read returns the current value of resource on deviceName.
func (r *Runtime) Read(deviceName, resource string) (any, error) {
	dr, err := r.runtimeFor(deviceName)
	if err != nil {
		return nil, err
	}
	return dr.Read(resource)
}

// Write sets the value of resource on deviceName.
func (r *Runtime) Write(deviceName, resource string, value any) error {
	dr, err := r.runtimeFor(deviceName)
	if err != nil {
		return err
	}
	return dr.Write(resource, value)
}

func (r *Runtime) runtimeFor(deviceName string) (DeviceRuntime, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	dr, ok := r.runtimes[deviceName]
	if !ok {
		return nil, fmt.Errorf("no Virtual Node Runtime registered for device %q", deviceName)
	}
	return dr, nil
}

// stateStore is the default DeviceRuntime: a plain thread-safe get/set map.
type stateStore struct {
	mu     sync.RWMutex
	values map[string]any
}

func newStateStore(initial map[string]any) *stateStore {
	values := make(map[string]any, len(initial))
	for k, v := range initial {
		values[k] = v
	}
	return &stateStore{values: values}
}

func (s *stateStore) Read(resource string) (any, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.values[resource]
	if !ok {
		return nil, fmt.Errorf("virtual device has no value for resource %q", resource)
	}
	return value, nil
}

func (s *stateStore) Write(resource string, value any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[resource] = value
	return nil
}
