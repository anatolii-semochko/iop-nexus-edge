// Extension points (AGENTS.md section 31) - process-kind counterpart of
// pluginDeviceTypes.js, same build-time import.meta.glob mechanism (a
// Vite/React bundle can't dynamically import an arbitrary file at
// runtime the way Node can). Deliberately the SAME `plugins/*/ui/
// register.js` glob pattern pluginDeviceTypes.js already uses, not a
// second file convention - a target project's one register.js can call
// deviceTypeRegistry.* and/or processTypeRegistry.* as needed; ES module
// caching means importing the same file from two different glob call
// sites still only runs its side effects once.
//
// plugins/ is empty in this repo (reserved, AGENTS.md section 2/4) -
// zero matches here, so this is a no-op for nexus-edge's own build.
import.meta.glob('plugins/*/ui/register.js', { eager: true })
