package can

import (
	"sync"
	"time"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/clients/logger"
)

// cachedFrame pairs a received Frame with the wall-clock time it actually
// arrived on the bus - see Latest's own comment for why this is tracked at
// all (AGENTS_TO_DO.md, 2026-08-15).
type cachedFrame struct {
	frame      Frame
	receivedAt time.Time
}

// busConn is one open CAN interface, shared by every device bound to it. A
// background goroutine continuously reads frames and caches the latest one
// per arbitration ID, since physical nodes broadcast telemetry on their own
// schedule - Read must not block waiting for the bus to happen to send the
// right frame.
type busConn struct {
	conn *Conn
	lc   logger.LoggingClient

	mu     sync.RWMutex
	latest map[uint32]cachedFrame

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
		latest: make(map[uint32]cachedFrame),
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
		b.latest[frame.ID] = cachedFrame{frame: frame, receivedAt: time.Now()}
		b.mu.Unlock()
	}
}

// Latest returns the most recently received frame for the given
// arbitration ID (if any has been seen since the bus was opened) alongside
// the time it actually arrived. The cache itself never expires - a
// physical node may legitimately broadcast a given signal rarely - so
// staleness is not decided here. Instead the receivedAt time is threaded
// through to the EdgeX Reading's own origin (transport.go's Read, via
// NewCommandValueWithOrigin) so this cached-but-old frame is reported with
// its true age rather than "now", letting the existing timestamp-based
// overdue checks (Devices list, Data Logger) do their job honestly
// (AGENTS_TO_DO.md, 2026-08-15 - previously every on-demand read re-
// stamped stale data as fresh, defeating those checks for any physically
// silent node).
func (b *busConn) Latest(id uint32) (Frame, time.Time, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	c, ok := b.latest[id]
	return c.frame, c.receivedAt, ok
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
