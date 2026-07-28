// Package extrares merges an optional extra profiles/devices directory
// (EXTRA_RES_DIR, extension points design - to-do.txt 2026-07-28) into
// this service's own ./res/profiles and ./res/devices before the EdgeX
// SDK's startup.Bootstrap runs.
//
// The SDK's Device.ProfilesDir/DevicesDir config keys each take exactly
// one directory (device-sdk-go/v4 internal/provision.LoadProfiles -
// verified by reading the SDK source, not assumed), and the loading
// itself happens inside startup.Bootstrap with no exposed hook to add a
// second source - internal/provision isn't importable from outside the
// SDK module. Symlinking extra files into the one directory the SDK
// already scans is the only integration point available without forking
// the SDK.
package extrares

import (
	"fmt"
	"os"
	"path/filepath"
)

// Merge symlinks every *.yaml/*.yml file from
// $EXTRA_RES_DIR/profiles into resProfilesDir and from
// $EXTRA_RES_DIR/devices into resDevicesDir. A no-op if EXTRA_RES_DIR is
// unset (this repo's own docker-compose) or a subdirectory doesn't
// exist. Fails loudly on a filename collision with a built-in
// profile/device file rather than silently letting one shadow the
// other.
func Merge(resProfilesDir, resDevicesDir string) error {
	extraDir := os.Getenv("EXTRA_RES_DIR")
	if extraDir == "" {
		return nil
	}

	if err := mergeInto(filepath.Join(extraDir, "profiles"), resProfilesDir); err != nil {
		return fmt.Errorf("extrares: profiles: %w", err)
	}
	if err := mergeInto(filepath.Join(extraDir, "devices"), resDevicesDir); err != nil {
		return fmt.Errorf("extrares: devices: %w", err)
	}
	return nil
}

func mergeInto(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		dst := filepath.Join(dstDir, entry.Name())
		if _, err := os.Lstat(dst); err == nil {
			return fmt.Errorf("%s already exists (built-in vs extra name collision)", dst)
		} else if !os.IsNotExist(err) {
			return err
		}

		src, err := filepath.Abs(filepath.Join(srcDir, entry.Name()))
		if err != nil {
			return err
		}
		if err := os.Symlink(src, dst); err != nil {
			return err
		}
	}
	return nil
}
