// Package transport defines the boundary every physical bus/protocol
// backend must implement. CAN (package transport/can) is the first and
// only implementation today; RS485, Modbus, MQTT etc. are meant to satisfy
// the same interface later without touching internal/driver.
package transport

import (
	"github.com/edgexfoundry/go-mod-core-contracts/v4/models"

	sdkModels "github.com/edgexfoundry/device-sdk-go/v4/pkg/models"
)

// PhysicalTransport is one physical bus/protocol a device can be bound to.
// A device names which transport serves it via its `transport.type`
// protocol property (see internal/driver/backend.go); the remaining
// properties in that same block (e.g. CAN's `bus`) are opaque to the driver
// core and interpreted only by the matching PhysicalTransport - each
// transport owns its own resource-to-wire addressing scheme (CAN:
// arbitration ID + byte offset; Modbus: register address; MQTT: topic;
// ...), which cannot be meaningfully unified beyond this Read/Write
// boundary.
type PhysicalTransport interface {
	// Name is the `transport.type` value that selects this transport,
	// e.g. "can".
	Name() string

	// Read and Write serve one device's commands. props is the device's
	// `transport` protocol properties block.
	Read(deviceName string, props models.ProtocolProperties, reqs []sdkModels.CommandRequest) ([]*sdkModels.CommandValue, error)
	Write(deviceName string, props models.ProtocolProperties, reqs []sdkModels.CommandRequest, params []*sdkModels.CommandValue) error

	// Close releases any resources (e.g. open bus connections) shared
	// across every device bound to this transport.
	Close() error
}
