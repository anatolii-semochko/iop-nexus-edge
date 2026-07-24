// Package can implements the NexusEdge PhysicalTransport interface (see
// internal/transport) over classic (not CAN-FD) SocketCAN: open an
// interface, send/receive raw frames, map device resources to bytes on the
// bus via device profile attributes. It is Linux-only (see can_linux.go /
// can_other.go) and has no knowledge of any specific device's signal
// layout beyond the generic one-resource-per-arbitration-ID mapping in
// mapping.go.
package can

import (
	"fmt"
	"sync"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/clients/logger"
	"github.com/edgexfoundry/go-mod-core-contracts/v4/models"

	sdkModels "github.com/edgexfoundry/device-sdk-go/v4/pkg/models"
)

// Transport is the CAN implementation of transport.PhysicalTransport.
type Transport struct {
	lc logger.LoggingClient

	mu  sync.Mutex
	bus map[string]*busConn // CAN interface name -> shared open connection
}

// New creates a CAN Transport. Bus connections are opened lazily, on first
// device bound to a given interface.
func New(lc logger.LoggingClient) *Transport {
	return &Transport{lc: lc, bus: make(map[string]*busConn)}
}

// Name implements transport.PhysicalTransport.
func (t *Transport) Name() string {
	return "can"
}

// Read implements transport.PhysicalTransport.
func (t *Transport) Read(deviceName string, props models.ProtocolProperties, reqs []sdkModels.CommandRequest) ([]*sdkModels.CommandValue, error) {
	cfg, err := configFrom(props)
	if err != nil {
		return nil, err
	}
	bus, err := t.ensureBus(cfg.Bus)
	if err != nil {
		return nil, err
	}

	results := make([]*sdkModels.CommandValue, 0, len(reqs))

	for _, req := range reqs {
		mapping, err := mappingFor(req.Attributes, req.Type)
		if err != nil {
			return nil, fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}

		frame, ok := bus.Latest(mapping.ArbitrationID)
		if !ok {
			return nil, fmt.Errorf("resource %s: no data received yet for CAN ID 0x%X", req.DeviceResourceName, mapping.ArbitrationID)
		}
		if mapping.ByteOffset+mapping.Length > len(frame.Data) {
			return nil, fmt.Errorf("resource %s: byte range [%d:%d] out of bounds for %d-byte frame 0x%X",
				req.DeviceResourceName, mapping.ByteOffset, mapping.ByteOffset+mapping.Length, len(frame.Data), mapping.ArbitrationID)
		}

		field := frame.Data[mapping.ByteOffset : mapping.ByteOffset+mapping.Length]
		value, err := decodeValue(req.Type, field)
		if err != nil {
			return nil, fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}

		cv, err := sdkModels.NewCommandValue(req.DeviceResourceName, req.Type, value)
		if err != nil {
			return nil, fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}
		results = append(results, cv)
	}

	return results, nil
}

// Write implements transport.PhysicalTransport.
func (t *Transport) Write(deviceName string, props models.ProtocolProperties, reqs []sdkModels.CommandRequest, params []*sdkModels.CommandValue) error {
	cfg, err := configFrom(props)
	if err != nil {
		return err
	}
	bus, err := t.ensureBus(cfg.Bus)
	if err != nil {
		return err
	}

	for i, req := range reqs {
		mapping, err := mappingFor(req.Attributes, req.Type)
		if err != nil {
			return fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}

		frameLen := mapping.ByteOffset + mapping.Length
		data := make([]byte, frameLen)
		// Preserve the other signals already carried by this arbitration ID,
		// since one CAN ID may in principle be shared - see mapping.go.
		if existing, ok := bus.Latest(mapping.ArbitrationID); ok {
			n := copy(data, existing.Data)
			if n < len(existing.Data) {
				data = append(data, existing.Data[n:]...)
			}
		}

		if err := encodeValue(req.Type, params[i].Value, data[mapping.ByteOffset:mapping.ByteOffset+mapping.Length]); err != nil {
			return fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}

		if err := bus.Send(Frame{ID: mapping.ArbitrationID, Data: data}); err != nil {
			return fmt.Errorf("resource %s: sending CAN frame: %w", req.DeviceResourceName, err)
		}
	}

	return nil
}

// Close implements transport.PhysicalTransport.
func (t *Transport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	for name, b := range t.bus {
		if err := b.Close(); err != nil {
			t.lc.Errorf("closing CAN bus %s: %s", name, err.Error())
		}
	}
	return nil
}

func (t *Transport) ensureBus(ifaceName string) (*busConn, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if b, ok := t.bus[ifaceName]; ok {
		return b, nil
	}

	b, err := newBusConn(ifaceName, t.lc)
	if err != nil {
		return nil, fmt.Errorf("open CAN bus %s: %w", ifaceName, err)
	}
	t.bus[ifaceName] = b
	return b, nil
}
