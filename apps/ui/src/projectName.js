// UI branding (extension points design, to-do.txt 2026-07-29 "Фаза В") -
// build-time only, same reasoning devices/plugins get compiled in at
// build time rather than loaded at runtime: a target project's own
// apps/ui/Dockerfile passes VITE_PROJECT_NAME as a build arg. Defaults
// to "NexusEdge" for this repo's own build (unset).
export const PROJECT_NAME = import.meta.env.VITE_PROJECT_NAME || 'NexusEdge'
