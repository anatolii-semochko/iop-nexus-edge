#!/bin/sh
# Bootstraps a new target project from templates/target-project/
# (extension points design, AGENTS_TO_DO.md 2026-07-29 "Фаза В") - see
# docs/CREATING_A_TARGET_PROJECT.md for the manual version of every
# step this automates. Run via `make new-project`, not directly (the
# Makefile target is the documented entrypoint).
#
# Deliberately NOT a generator invoked from anywhere - always run from
# inside this nexus-edge checkout, since NEXUS_EDGE_SOURCE_PATH is
# computed from this script's own location.
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NEXUS_EDGE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TEMPLATE_DIR="$NEXUS_EDGE_DIR/templates/target-project"

printf 'Project display name (shown in the UI next to the logo): '
read -r PROJECT_NAME
if [ -z "$PROJECT_NAME" ]; then
  echo "A project name is required." >&2
  exit 1
fi

printf 'Target folder path (absolute or relative - not required to be a sibling of nexus-edge): '
read -r TARGET_PATH_RAW
if [ -z "$TARGET_PATH_RAW" ]; then
  echo "A target folder path is required." >&2
  exit 1
fi

if [ -e "$TARGET_PATH_RAW" ]; then
  echo "$TARGET_PATH_RAW already exists - pick a new path (this script only creates new projects)." >&2
  exit 1
fi

mkdir -p "$TARGET_PATH_RAW"
TARGET_DIR=$(cd "$TARGET_PATH_RAW" && pwd)

# Slug: the folder's own basename, lowercased, non-alnum runs collapsed
# to a single hyphen - used for the compose project name, container
# name prefixes, and Postgres/RabbitMQ default credentials. Not a
# separate prompt - the folder name already carries this information,
# asking twice invites them to disagree.
SLUG=$(basename "$TARGET_DIR" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
if [ -z "$SLUG" ]; then
  echo "Could not derive a usable name from '$TARGET_DIR' - rename the target folder to something with at least one letter or digit." >&2
  rmdir "$TARGET_DIR" 2>/dev/null || true
  exit 1
fi

NEXUS_EDGE_VERSION=$(grep -m1 '"version"' "$NEXUS_EDGE_DIR/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
NEXUS_EDGE_SOURCE_PATH=$(realpath --relative-to="$TARGET_DIR" "$NEXUS_EDGE_DIR" 2>/dev/null || echo "$NEXUS_EDGE_DIR")

echo "Generating '$PROJECT_NAME' (slug: $SLUG) at $TARGET_DIR ..."
echo "  nexus-edge source: $NEXUS_EDGE_SOURCE_PATH (version $NEXUS_EDGE_VERSION)"

# cp -R rather than a manifest of individual files - templates/target-project/
# IS the manifest; adding a file there should not also require editing
# this script.
cp -R "$TEMPLATE_DIR/." "$TARGET_DIR/"

# Substitute placeholders across every copied file (config/text only -
# templates/target-project/ has no binary assets today; revisit this
# loop if it ever gains one).
find "$TARGET_DIR" -type f -print0 | xargs -0 sed -i \
  -e "s|__PROJECT_NAME__|$PROJECT_NAME|g" \
  -e "s|__SLUG__|$SLUG|g" \
  -e "s|__NEXUS_EDGE_SOURCE_PATH__|$NEXUS_EDGE_SOURCE_PATH|g" \
  -e "s|__NEXUS_EDGE_VERSION__|$NEXUS_EDGE_VERSION|g"

cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
# .env additionally gets project-specific credentials .env.example
# deliberately leaves as generic placeholders (change-me) - only the
# ones a fresh `make up-all` needs to not immediately fail on.
sed -i \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=change-me|" \
  -e "s|^RABBITMQ_DEFAULT_PASS=.*|RABBITMQ_DEFAULT_PASS=change-me|" \
  "$TARGET_DIR/.env"

if [ ! -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" init -q
fi

cat <<EOF

Done. Next steps:
  cd $TARGET_PATH_RAW
  \$EDITOR .env               # review ports/credentials - see the file's
                              # own header comment about checking for
                              # collisions with other running projects
  make up-all                 # build + start everything, including EdgeX

Then follow docs/CREATING_A_TARGET_PROJECT.md sections 5-7 (in this
nexus-edge checkout) to add your first DNP/command/UI plugin.
EOF
