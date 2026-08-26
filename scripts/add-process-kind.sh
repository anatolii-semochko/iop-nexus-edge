#!/bin/sh
# Copies a process-kind template from the Library catalog
# (devices/processes/<kind>/, AGENTS_TO_DO.md 2026-08-14 process
# management) into a target project's own plugins/<new-kind>/ - the
# filesystem half of "add a process kind"; the `processes` table row
# itself is created separately (POST /processes, or the Processes page's
# own "Add process" UI), and the orchestrator needs a restart afterward
# to actually load the copied code (loadProcessPlugins() only scans once
# at startup - see AGENTS.md section 51, and the Processes page's own
# "pending restart" highlight for a row whose kind isn't loaded yet).
#
# Run via `make add-process-kind`, not directly (see Makefile target).
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NEXUS_EDGE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

SOURCE_KIND="$1"
TARGET_PROJECT_PATH="$2"
NEW_KIND_NAME="${3:-$SOURCE_KIND}"

if [ -z "$SOURCE_KIND" ] || [ -z "$TARGET_PROJECT_PATH" ]; then
  echo "Usage: $0 <source-kind-under-devices/processes> <target-project-path> [new-kind-name]" >&2
  echo "Example: $0 example-threshold-monitor ../nexus-edge-aquarium tank-ph-monitor" >&2
  exit 1
fi

SOURCE_DIR="$NEXUS_EDGE_DIR/devices/processes/$SOURCE_KIND"
if [ ! -f "$SOURCE_DIR/process.ts" ]; then
  echo "add-process-kind: no devices/processes/$SOURCE_KIND/process.ts found in this nexus-edge checkout." >&2
  exit 1
fi

TARGET_DIR=$(cd "$TARGET_PROJECT_PATH" && pwd)/plugins/"$NEW_KIND_NAME"
if [ -e "$TARGET_DIR/process.ts" ]; then
  echo "add-process-kind: $TARGET_DIR/process.ts already exists - not overwriting." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR/process.ts" "$TARGET_DIR/process.ts"

if [ "$NEW_KIND_NAME" != "$SOURCE_KIND" ]; then
  # Best-effort rename of the register() call's own kind string - the
  # single most common edit anyone copying a template makes first. Not a
  # general templating engine: only this one literal string is touched,
  # everything else in the copied file is left exactly as the source
  # template wrote it, on purpose (see process.ts's own header - real
  # adaptation is a manual step, not something this script should guess
  # at).
  sed -i.bak "s/register(\"$SOURCE_KIND\"/register(\"$NEW_KIND_NAME\"/" "$TARGET_DIR/process.ts"
  rm -f "$TARGET_DIR/process.ts.bak"
fi

echo "add-process-kind: copied to $TARGET_DIR/process.ts (kind: $NEW_KIND_NAME)."
echo "Next: create its processes row (POST /processes or the Processes page's 'Add process' UI, kind=\"$NEW_KIND_NAME\"), then restart the orchestrator container so it loads the new plugin file."
