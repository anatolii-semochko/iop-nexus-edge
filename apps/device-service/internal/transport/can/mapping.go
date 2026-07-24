package can

import (
	"fmt"
	"strconv"
)

// resourceMapping is where in a CAN frame a single device resource lives.
// It is declared per-resource in the device profile's `attributes:` block,
// e.g.:
//
//	deviceResources:
//	  - name: Temperature
//	    properties:
//	      valueType: Float32
//	      readWrite: R
//	    attributes:
//	      canId: "0x100"
//	      byteOffset: 0
//
// One resource per CAN ID is assumed for now; bit-packed multi-signal
// frames are not supported (see codec.go).
type resourceMapping struct {
	ArbitrationID uint32
	ByteOffset    int
	Length        int
}

// mappingFor resolves a resource's CAN location from its profile
// attributes and value type. length is derived from valueType unless
// overridden by an explicit "length" attribute.
func mappingFor(attrs map[string]any, valueType string) (resourceMapping, error) {
	rawID, ok := attrs["canId"]
	if !ok {
		return resourceMapping{}, fmt.Errorf("resource is missing required %q attribute", "canId")
	}
	id, err := parseCANID(fmt.Sprintf("%v", rawID))
	if err != nil {
		return resourceMapping{}, err
	}

	offset := 0
	if rawOffset, ok := attrs["byteOffset"]; ok {
		offset, err = strconv.Atoi(fmt.Sprintf("%v", rawOffset))
		if err != nil {
			return resourceMapping{}, fmt.Errorf("invalid %q attribute: %w", "byteOffset", err)
		}
	}

	length, err := byteLengthFor(valueType)
	if err != nil {
		return resourceMapping{}, err
	}
	if rawLength, ok := attrs["length"]; ok {
		length, err = strconv.Atoi(fmt.Sprintf("%v", rawLength))
		if err != nil {
			return resourceMapping{}, fmt.Errorf("invalid %q attribute: %w", "length", err)
		}
	}

	return resourceMapping{ArbitrationID: id, ByteOffset: offset, Length: length}, nil
}

// parseCANID accepts both hex ("0x100") and decimal ("256") arbitration IDs.
func parseCANID(s string) (uint32, error) {
	id, err := strconv.ParseUint(s, 0, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid CAN arbitration ID %q: %w", s, err)
	}
	return uint32(id), nil
}
