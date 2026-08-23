import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'

// One Device's current value - REST fetch on mount, live-overlaid. Shared
// by WeatherControlPanel.jsx (five readings) and WeatherZonesSection.jsx
// (the raw light value the zone diagram's marker tracks) - same pattern
// TemperatureProcessPanel.jsx already used inline for its own sensor/
// heater/cooler reads.
export const useDeviceValue = (deviceId) => {
  const [device, setDevice] = useState(null)
  const live = useDeviceLiveState(deviceId)
  useEffect(() => {
    if (deviceId == null) return
    api
      .getDevice(deviceId)
      .then(setDevice)
      .catch(() => setDevice(null))
  }, [deviceId])
  return live.value !== undefined ? live.value : device?.value
}
