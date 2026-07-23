package can

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/common"
)

// byteLengthFor returns the number of bytes a value of valueType occupies
// within a CAN frame, for the small set of types this generic CAN mapping
// supports today. Multi-signal bit-packed frames (e.g. DBC-style) are not
// supported yet - each mapped resource occupies its own byte range.
func byteLengthFor(valueType string) (int, error) {
	switch valueType {
	case common.ValueTypeBool:
		return 1, nil
	case common.ValueTypeInt32, common.ValueTypeUint32, common.ValueTypeFloat32:
		return 4, nil
	default:
		return 0, fmt.Errorf("unsupported value type for CAN mapping: %s", valueType)
	}
}

// decodeValue reads a value of valueType out of field, which must be
// exactly byteLengthFor(valueType) bytes long.
func decodeValue(valueType string, field []byte) (any, error) {
	switch valueType {
	case common.ValueTypeBool:
		return field[0] != 0, nil
	case common.ValueTypeInt32:
		return int32(binary.LittleEndian.Uint32(field)), nil
	case common.ValueTypeUint32:
		return binary.LittleEndian.Uint32(field), nil
	case common.ValueTypeFloat32:
		return math.Float32frombits(binary.LittleEndian.Uint32(field)), nil
	default:
		return nil, fmt.Errorf("unsupported value type for CAN mapping: %s", valueType)
	}
}

// encodeValue writes value (of valueType) into dst, which must be exactly
// byteLengthFor(valueType) bytes long.
func encodeValue(valueType string, value any, dst []byte) error {
	switch valueType {
	case common.ValueTypeBool:
		v, ok := value.(bool)
		if !ok {
			return fmt.Errorf("expected bool value, got %T", value)
		}
		if v {
			dst[0] = 1
		} else {
			dst[0] = 0
		}
		return nil

	case common.ValueTypeInt32:
		v, ok := value.(int32)
		if !ok {
			return fmt.Errorf("expected int32 value, got %T", value)
		}
		binary.LittleEndian.PutUint32(dst, uint32(v))
		return nil

	case common.ValueTypeUint32:
		v, ok := value.(uint32)
		if !ok {
			return fmt.Errorf("expected uint32 value, got %T", value)
		}
		binary.LittleEndian.PutUint32(dst, v)
		return nil

	case common.ValueTypeFloat32:
		v, ok := value.(float32)
		if !ok {
			return fmt.Errorf("expected float32 value, got %T", value)
		}
		binary.LittleEndian.PutUint32(dst, math.Float32bits(v))
		return nil

	default:
		return fmt.Errorf("unsupported value type for CAN mapping: %s", valueType)
	}
}
