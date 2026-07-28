// Extension points (to-do.txt 2026-07-28) - build-time equivalent of
// apiPlugins.ts's runtime directory scan. A Vite/React bundle can't
// dynamically import an arbitrary file at runtime the way Node can
// (everything ships as one static bundle), so plugin UI registration
// has to happen at build time instead - import.meta.glob is resolved
// by Vite while bundling, not at page load.
//
// A target project's own plugins/<name>/ui/register.js is a plain
// side-effect file, same style as builtinDeviceTypes.js: it imports
// deviceControls/deviceSimulators and its own component, and registers
// it directly - no factory-function wrapper needed. { eager: true }
// imports every match immediately (not lazily on first render), so
// registration is guaranteed to run before App renders, same guarantee
// builtinDeviceTypes.js already provides for built-in types.
//
// plugins/ is empty in this repo (reserved, AGENTS.md section 2/4) -
// zero matches here, so this is a no-op for nexus-edge's own build.
import.meta.glob('plugins/*/ui/register.js', { eager: true })
