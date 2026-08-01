import { startOrchestrator } from "./server.js";

// This container's actual entrypoint (Dockerfile CMD) - a thin wrapper
// around startOrchestrator() (extension points design, AGENTS_TO_DO.md
// 2026-07-28), which a target project imports and calls directly instead
// of running this file.
startOrchestrator().catch((err) => {
  console.error(err);
  process.exit(1);
});
