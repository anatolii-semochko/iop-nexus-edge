package main

import (
	"github.com/edgexfoundry/device-sdk-go/v4/pkg/startup"

	deviceservice "github.com/anatolii-semochko/iop-nexus-edge/apps/device-service"
	"github.com/anatolii-semochko/iop-nexus-edge/apps/device-service/internal/driver"
)

const serviceName = "device-nexus-edge"

func main() {
	startup.Bootstrap(serviceName, deviceservice.Version, driver.New())
}
