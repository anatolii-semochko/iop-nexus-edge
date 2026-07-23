package driver

import (
	"fmt"

	sdkModels "github.com/edgexfoundry/device-sdk-go/v4/pkg/models"
)

func (d *NexusDriver) readVirtual(deviceName string, reqs []sdkModels.CommandRequest) ([]*sdkModels.CommandValue, error) {
	results := make([]*sdkModels.CommandValue, 0, len(reqs))

	for _, req := range reqs {
		value, err := d.virtual.Read(deviceName, req.DeviceResourceName)
		if err != nil {
			return nil, err
		}

		value, err = coerceToValueType(req.Type, value)
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

func (d *NexusDriver) writeVirtual(deviceName string, reqs []sdkModels.CommandRequest, params []*sdkModels.CommandValue) error {
	for i, req := range reqs {
		if err := d.virtual.Write(deviceName, req.DeviceResourceName, params[i].Value); err != nil {
			return fmt.Errorf("resource %s: %w", req.DeviceResourceName, err)
		}
	}
	return nil
}
