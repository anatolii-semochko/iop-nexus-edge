//go:build !linux

package can

import "fmt"

// Conn is a non-Linux stub. SocketCAN is Linux-only; this file exists
// purely so the package (and anything importing it) still builds and
// typechecks on non-Linux development machines. The service only ever
// actually runs inside the Linux container image (see AGENTS.md section 1).
type Conn struct{}

func Open(ifaceName string) (*Conn, error) {
	return nil, fmt.Errorf("SocketCAN is only supported on Linux, cannot open %q on this platform", ifaceName)
}

func (c *Conn) Close() error { return nil }

func (c *Conn) Send(f Frame) error {
	return fmt.Errorf("SocketCAN is only supported on Linux")
}

func (c *Conn) Receive() (Frame, error) {
	return Frame{}, fmt.Errorf("SocketCAN is only supported on Linux")
}
