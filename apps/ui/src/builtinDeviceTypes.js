// Registers every device type bundled with nexus-edge itself into
// deviceTypeRegistry - imported once for its side effect (index.jsx),
// before anything reads the registry. See deviceTypeRegistry.js.
import LightRegulatorControl from 'devices/standalone/actuator/light-regulator/ui/control/LightRegulatorControl.jsx'
import ActiveBuzzerControl from 'devices/standalone/indicator/active-buzzer/ui/control/ActiveBuzzerControl.jsx'
import LedControl from 'devices/standalone/indicator/led/ui/control/LedControl.jsx'
import LightRegulatorSimulator from 'devices/standalone/actuator/light-regulator/ui/simulator/LightRegulatorSimulator.jsx'
import ActiveBuzzerSimulator from 'devices/standalone/indicator/active-buzzer/ui/simulator/ActiveBuzzerSimulator.jsx'
import LedSimulator from 'devices/standalone/indicator/led/ui/simulator/LedSimulator.jsx'
import { deviceTypeRegistry } from './deviceTypeRegistry'

deviceTypeRegistry.registerControl('light-regulator', LightRegulatorControl)
deviceTypeRegistry.registerControl('active-buzzer', ActiveBuzzerControl)
deviceTypeRegistry.registerControl('led', LedControl)
deviceTypeRegistry.registerSimulator('light-regulator', LightRegulatorSimulator)
// Both added 2026-08-09 for the "control-node" node type (AGENTS_TO_DO.md,
// "НОДА КОНТРОЛЮ") - the first Dev Simulator consumers of these two
// device kinds, previously falling back to the generic Bool checkbox.
deviceTypeRegistry.registerSimulator('active-buzzer', ActiveBuzzerSimulator)
deviceTypeRegistry.registerSimulator('led', LedSimulator)
