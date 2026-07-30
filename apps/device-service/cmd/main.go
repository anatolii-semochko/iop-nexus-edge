package main

import (
	"log"

	"github.com/edgexfoundry/device-sdk-go/v4/pkg/startup"

	deviceservice "github.com/anatolii-semochko/iop-nexus-edge/apps/device-service"
	"github.com/anatolii-semochko/iop-nexus-edge/apps/device-service/internal/driver"
	"github.com/anatolii-semochko/iop-nexus-edge/apps/device-service/internal/extrares"
)

const serviceName = "device-nexus-edge"

func main() {
	// Extension points (AGENTS_TO_DO.md 2026-07-28) - must run before Bootstrap,
	// which is what actually reads ./res/profiles and ./res/devices.
	if err := extrares.Merge("./res/profiles", "./res/devices"); err != nil {
		log.Fatalf("extrares.Merge: %v", err)
	}

	startup.Bootstrap(serviceName, deviceservice.Version, driver.New())
}
