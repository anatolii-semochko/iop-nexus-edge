// Registers every device type bundled with nexus-edge itself into
// deviceTypeRegistry - imported once for its side effect (index.jsx),
// before anything reads the registry. See deviceTypeRegistry.js.
import LightRegulatorControl from 'devices/standalone/light-regulator/ui/control/LightRegulatorControl.jsx'
import ActiveBuzzerControl from 'devices/standalone/active-buzzer/ui/control/ActiveBuzzerControl.jsx'
import LightRegulatorSimulator from 'devices/standalone/light-regulator/ui/simulator/LightRegulatorSimulator.jsx'
import { deviceTypeRegistry } from './deviceTypeRegistry'

deviceTypeRegistry.registerControl('light-regulator', LightRegulatorControl)
deviceTypeRegistry.registerControl('active-buzzer', ActiveBuzzerControl)
deviceTypeRegistry.registerSimulator('light-regulator', LightRegulatorSimulator)
