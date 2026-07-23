package driver

import (
	"fmt"
	"strings"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/models"
)

// mode is the per-device backend: which implementation actually serves the
// device's read/write commands. EdgeX itself has no notion of this - it is
// this driver's own logic, resolved per device from its protocol
// properties (see AGENTS.md section 6). It is config-time only: changing a
// device's mode means updating its EdgeX device entry and restarting this
// service, not a live runtime toggle (deliberately - see AGENTS.md section 6
// for why hot-swapping a physically engaged device is unsafe).
type mode string

const (
	modeVirtual  mode = "virtual"
	modePhysical mode = "physical"

	// protocolBackend is the protocol properties key every device managed
	// by this service must declare, selecting its backend.
	protocolBackend = "backend"
	// protocolTransport is the protocol properties key physical-backend
	// devices must additionally declare, naming which PhysicalTransport
	// (see internal/transport) serves them - "can" today, others (RS485,
	// Modbus, MQTT, ...) later. The remaining properties in this same
	// block are transport-specific and are parsed only by the matching
	// transport implementation, not here.
	protocolTransport = "transport"
	// protocolVirtual is the optional protocol properties key virtual
	// devices may declare, to seed the Virtual Node Runtime's initial
	// state. Keys are flat ("initial.<resourceName>") rather than a nested
	// map, to sidestep any ambiguity in how YAML device-list files decode
	// nested values into ProtocolProperties (map[string]any).
	protocolVirtual  = "virtual"
	initialKeyPrefix = "initial."
)

// backend is the resolved, validated backend configuration for one device.
type backend struct {
	Mode mode
	// TransportName is only set (and only meaningful) when Mode is
	// modePhysical - it selects which registered PhysicalTransport serves
	// this device (see driver.go's transports registry).
	TransportName string
}

// backendFor resolves and validates a device's backend from its EdgeX
// protocol properties. It only resolves which transport a physical device
// names, not that transport's own properties (e.g. CAN's "bus") - those are
// validated by the transport implementation itself on first use.
func backendFor(protocols map[string]models.ProtocolProperties) (backend, error) {
	props, ok := protocols[protocolBackend]
	if !ok {
		return backend{}, fmt.Errorf("device is missing required %q protocol properties", protocolBackend)
	}

	rawMode, ok := props["mode"]
	if !ok {
		return backend{}, fmt.Errorf("%q protocol is missing required %q property", protocolBackend, "mode")
	}

	b := backend{Mode: mode(fmt.Sprintf("%v", rawMode))}

	switch b.Mode {
	case modeVirtual:
		return b, nil

	case modePhysical:
		transportProps, ok := protocols[protocolTransport]
		if !ok {
			return backend{}, fmt.Errorf("physical device is missing required %q protocol properties", protocolTransport)
		}

		typ, ok := transportProps["type"]
		if !ok {
			return backend{}, fmt.Errorf("%q protocol is missing required %q property", protocolTransport, "type")
		}

		b.TransportName = fmt.Sprintf("%v", typ)
		return b, nil

	default:
		return backend{}, fmt.Errorf("unknown %q mode %q: must be %q or %q", protocolBackend, b.Mode, modeVirtual, modePhysical)
	}
}

// virtualSeedFrom extracts a virtual device's initial resource values from
// its optional "virtual" protocol properties (keys "initial.<resourceName>").
// Returns nil (no seeding) if the device declares no such properties.
func virtualSeedFrom(protocols map[string]models.ProtocolProperties) map[string]any {
	props, ok := protocols[protocolVirtual]
	if !ok {
		return nil
	}

	seed := make(map[string]any)
	for key, value := range props {
		resource, ok := strings.CutPrefix(key, initialKeyPrefix)
		if !ok {
			continue
		}
		seed[resource] = value
	}
	return seed
}
