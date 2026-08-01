import { startApiServer } from "./server.js";

// This container's actual entrypoint (Dockerfile CMD) - a thin wrapper
// around startApiServer() (extension points design, AGENTS_TO_DO.md
// 2026-07-28), which a target project imports and calls directly instead
// of running this file.
startApiServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
