// Package can implements a minimal classic-CAN (not CAN-FD) SocketCAN
// transport: open an interface, send/receive raw frames. It has no
// knowledge of any specific device's signal layout - that mapping (which
// arbitration ID, byte offset, length) lives in the device profile and is
// resolved by the driver package.
package can

import "fmt"

// FrameSize is the size in bytes of a classic SocketCAN "struct can_frame"
// on the wire: 4 bytes ID + 1 byte length + 3 bytes padding + 8 bytes data.
const FrameSize = 16

// MaxDataLen is the maximum payload length of a classic CAN frame.
const MaxDataLen = 8

// Frame is a classic CAN data frame.
type Frame struct {
	ID   uint32
	Data []byte
}

func encode(f Frame) ([]byte, error) {
	if len(f.Data) > MaxDataLen {
		return nil, fmt.Errorf("CAN frame data too long: %d bytes (max %d)", len(f.Data), MaxDataLen)
	}

	buf := make([]byte, FrameSize)
	buf[0] = byte(f.ID)
	buf[1] = byte(f.ID >> 8)
	buf[2] = byte(f.ID >> 16)
	buf[3] = byte(f.ID >> 24)
	buf[4] = byte(len(f.Data))
	copy(buf[8:8+len(f.Data)], f.Data)
	return buf, nil
}

func decode(buf []byte) (Frame, error) {
	if len(buf) != FrameSize {
		return Frame{}, fmt.Errorf("invalid CAN frame size: got %d bytes, want %d", len(buf), FrameSize)
	}

	length := int(buf[4])
	if length > MaxDataLen {
		return Frame{}, fmt.Errorf("invalid CAN frame data length: %d", length)
	}

	id := uint32(buf[0]) | uint32(buf[1])<<8 | uint32(buf[2])<<16 | uint32(buf[3])<<24
	data := make([]byte, length)
	copy(data, buf[8:8+length])
	return Frame{ID: id, Data: data}, nil
}
