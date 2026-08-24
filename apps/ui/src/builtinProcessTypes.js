// Registers every process kind bundled with nexus-edge itself into
// processTypeRegistry - imported once for its side effect (index.jsx),
// before anything reads the registry. See processTypeRegistry.js.
import TemperatureProcessPanel from './views/processes/TemperatureProcessPanel'
import HeartbeatControlPanel from './views/processes/HeartbeatControlPanel'
import HeartbeatControlTestPanel from './views/processes/HeartbeatControlTestPanel'
import ResourceMonitorPanel from './views/processes/ResourceMonitorPanel'
import ActiveBuzzerPanel from './views/processes/ActiveBuzzerPanel'
import DataLoggerPanel from './views/processes/DataLoggerPanel'
import AnnunciatorPanel from './views/processes/AnnunciatorPanel'
import ControlNodePanel from './views/processes/ControlNodePanel'
import WeatherControlPanel from './views/processes/WeatherControlPanel'
import AnnunciatorSlotsSection from './views/processes/AnnunciatorSlotsSection'
import WeatherZonesSection from './views/processes/WeatherZonesSection'
import { processTypeRegistry } from './processTypeRegistry'

processTypeRegistry.registerPanel('temperature-control', TemperatureProcessPanel)
processTypeRegistry.registerPanel('temperature-monitor', TemperatureProcessPanel)
processTypeRegistry.registerPanel('heartbeat-control', HeartbeatControlPanel)
processTypeRegistry.registerPanel('heartbeat-control-test', HeartbeatControlTestPanel)
processTypeRegistry.registerPanel('resource-monitor', ResourceMonitorPanel)
processTypeRegistry.registerPanel('active-buzzer', ActiveBuzzerPanel)
processTypeRegistry.registerPanel('data-logger', DataLoggerPanel)
processTypeRegistry.registerPanel('alarm-annunciator', AnnunciatorPanel)
// Runner lives in a target project's own plugins/control-node/process.ts,
// panel stays here - control-node/weather-control are CORE-owned node
// types (Проект CORE), unlike a target project's own private process
// kinds, which register their own panel via plugins/*/ui/register.js.
processTypeRegistry.registerPanel('control-node', ControlNodePanel)
processTypeRegistry.registerPanel('weather-control', WeatherControlPanel)

processTypeRegistry.registerSettingsSection('alarm-annunciator', AnnunciatorSlotsSection, 'slots')
processTypeRegistry.registerSettingsSection('weather-control', WeatherZonesSection, 'zones')
