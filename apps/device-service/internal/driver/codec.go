package driver

import (
	"fmt"

	"github.com/edgexfoundry/go-mod-core-contracts/v4/common"
)

// coerceToValueType converts loosely-typed values - as produced by generic
// sources with no notion of EdgeX value types, e.g. YAML decoding (which
// turns any whole or decimal number into int/float64) - into the exact
// native Go type sdkModels.NewCommandValue requires for valueType. Used by
// the Virtual Node Runtime read path, since its in-memory state store
// deliberately has no per-resource type information (see
// internal/virtual/runtime.go).
func coerceToValueType(valueType string, value any) (any, error) {
	switch valueType {
	case common.ValueTypeBool:
		v, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("expected bool value, got %T", value)
		}
		return v, nil

	case common.ValueTypeInt32:
		n, err := toInt64(value)
		if err != nil {
			return nil, err
		}
		return int32(n), nil

	case common.ValueTypeUint32:
		n, err := toInt64(value)
		if err != nil {
			return nil, err
		}
		return uint32(n), nil

	case common.ValueTypeFloat32:
		f, err := toFloat64(value)
		if err != nil {
			return nil, err
		}
		return float32(f), nil

	case common.ValueTypeFloat64:
		return toFloat64(value)

	case common.ValueTypeString:
		v, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("expected string value, got %T", value)
		}
		return v, nil

	default:
		// Passed through unchanged for types this helper doesn't special-case;
		// NewCommandValue will reject it if it's still the wrong native type.
		return value, nil
	}
}

func toInt64(value any) (int64, error) {
	switch v := value.(type) {
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case int32:
		// A resource previously written as Int32/Uint32 round-trips back
		// through here on the next read already carrying its coerced
		// native Go type (see writeVirtual, which stores
		// params[i].Value as-is) - not the generic int/float64 a fresh
		// YAML-seeded value would arrive as. Both shapes must be
		// accepted, not just the seed-time one.
		return int64(v), nil
	case uint32:
		return int64(v), nil
	case uint64:
		return int64(v), nil
	case float64:
		return int64(v), nil
	default:
		return 0, fmt.Errorf("expected a numeric value, got %T", value)
	}
}

func toFloat64(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	default:
		return 0, fmt.Errorf("expected a numeric value, got %T", value)
	}
}
