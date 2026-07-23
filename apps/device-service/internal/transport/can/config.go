package can

import (
	"fmt"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/models"
)

// deviceConfig is one device's CAN-specific transport properties -
// `protocols.transport` for a device whose `transport.type` is "can".
type deviceConfig struct {
	// Bus is the SocketCAN interface name (e.g. "can0").
	Bus string
}

func configFrom(props models.ProtocolProperties) (deviceConfig, error) {
	bus, ok := props["bus"]
	if !ok {
		return deviceConfig{}, fmt.Errorf("CAN transport is missing required %q property", "bus")
	}
	return deviceConfig{Bus: fmt.Sprintf("%v", bus)}, nil
}
