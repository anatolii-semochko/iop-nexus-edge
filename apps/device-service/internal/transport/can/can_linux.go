//go:build linux

package can

import (
	"fmt"
	"net"

	"golang.org/x/sys/unix"
)

// Conn is an open SocketCAN raw connection on a single interface (e.g.
// "can0"). Safe for concurrent use by a single reader and a single writer;
// callers needing concurrent readers must add their own synchronization.
type Conn struct {
	fd int
}

// Open binds a CAN_RAW socket to the named SocketCAN interface. The
// interface (e.g. a CANable Pro exposed via the gs_usb kernel driver) must
// already exist and be up (`ip link set <iface> up type can bitrate <n>`) -
// this package does not configure the interface itself.
func Open(ifaceName string) (*Conn, error) {
	iface, err := net.InterfaceByName(ifaceName)
	if err != nil {
		return nil, fmt.Errorf("lookup CAN interface %q: %w", ifaceName, err)
	}

	fd, err := unix.Socket(unix.AF_CAN, unix.SOCK_RAW, unix.CAN_RAW)
	if err != nil {
		return nil, fmt.Errorf("open CAN raw socket: %w", err)
	}

	addr := &unix.SockaddrCAN{Ifindex: iface.Index}
	if err := unix.Bind(fd, addr); err != nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("bind CAN socket to %q: %w", ifaceName, err)
	}

	return &Conn{fd: fd}, nil
}

// Close closes the underlying socket. Any in-flight Receive unblocks with
// an error.
func (c *Conn) Close() error {
	return unix.Close(c.fd)
}

// Send writes a single CAN frame to the bus.
func (c *Conn) Send(f Frame) error {
	buf, err := encode(f)
	if err != nil {
		return err
	}
	if _, err := unix.Write(c.fd, buf); err != nil {
		return fmt.Errorf("write CAN frame: %w", err)
	}
	return nil
}

// Receive blocks until a single CAN frame is read from the bus.
func (c *Conn) Receive() (Frame, error) {
	buf := make([]byte, FrameSize)
	n, err := unix.Read(c.fd, buf)
	if err != nil {
		return Frame{}, fmt.Errorf("read CAN frame: %w", err)
	}
	if n != FrameSize {
		return Frame{}, fmt.Errorf("short CAN frame read: got %d bytes, want %d", n, FrameSize)
	}
	return decode(buf)
}
