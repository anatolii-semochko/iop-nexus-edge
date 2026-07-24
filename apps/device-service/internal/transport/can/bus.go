package can

import (
	"sync"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/clients/logger"
)

// busConn is one open CAN interface, shared by every device bound to it. A
// background goroutine continuously reads frames and caches the latest one
// per arbitration ID, since physical nodes broadcast telemetry on their own
// schedule - Read must not block waiting for the bus to happen to send the
// right frame.
type busConn struct {
	conn *Conn
	lc   logger.LoggingClient

	mu     sync.RWMutex
	latest map[uint32]Frame

	stop chan struct{}
}

func newBusConn(ifaceName string, lc logger.LoggingClient) (*busConn, error) {
	conn, err := Open(ifaceName)
	if err != nil {
		return nil, err
	}

	b := &busConn{
		conn:   conn,
		lc:     lc,
		latest: make(map[uint32]Frame),
		stop:   make(chan struct{}),
	}
	go b.readLoop(ifaceName)
	return b, nil
}

func (b *busConn) readLoop(ifaceName string) {
	for {
		frame, err := b.conn.Receive()
		if err != nil {
			select {
			case <-b.stop:
				// Close() closed the socket to unblock Receive; exit quietly.
				return
			default:
				b.lc.Errorf("CAN bus %s: read error, stopping bus reader: %s", ifaceName, err.Error())
				return
			}
		}

		b.mu.Lock()
		b.latest[frame.ID] = frame
		b.mu.Unlock()
	}
}

// Latest returns the most recently received frame for the given
// arbitration ID, if any has been seen since the bus was opened.
func (b *busConn) Latest(id uint32) (Frame, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	f, ok := b.latest[id]
	return f, ok
}

// Send writes a frame to the bus.
func (b *busConn) Send(f Frame) error {
	return b.conn.Send(f)
}

// Close stops the reader goroutine and closes the underlying socket.
func (b *busConn) Close() error {
	close(b.stop)
	return b.conn.Close()
}
