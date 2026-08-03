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

# Refuse a target path nested inside this nexus-edge checkout itself -
# a target project depends on nexus-edge from the outside
# (NEXUS_EDGE_SOURCE_PATH), it must not end up living inside it.
# realpath -m resolves the would-be absolute path without requiring it
# to exist yet, so this runs before anything is created.
TARGET_ABS=$(realpath -m "$TARGET_PATH_RAW")
case "$TARGET_ABS/" in
  "$NEXUS_EDGE_DIR/"*)
    echo "$TARGET_PATH_RAW resolves to $TARGET_ABS, which is inside this nexus-edge checkout ($NEXUS_EDGE_DIR) - pick a path outside it." >&2
    exit 1
    ;;
esac

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
# A *local filesystem path* (NEXUS_EDGE_SOURCE_PATH above) only makes
# sense in a docker-compose build context or in .env, on the machine
# that generated this project - it is meaningless (and actively
# misleading) as a link target in README.md, since a target project
# lives in its own separate git repo. GitHub even mangles it: a
# relative link like `../nexus-edge` from a repo's README resolves
# against the *current repo's* blob URL, so `../nexus-edge` becomes
# `.../<this-repo>/blob/nexus-edge` - GitHub then reads "nexus-edge" as
# a branch name *in this repo*, not a path to a different one. README.md
# needs a real, stable, cross-repo URL instead - derived from this
# checkout's own `origin` remote (falls back to the known public URL if
# there is no remote, e.g. a from-scratch tarball checkout).
NEXUS_EDGE_REPO_URL=$(git -C "$NEXUS_EDGE_DIR" remote get-url origin 2>/dev/null | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##')
if [ -z "$NEXUS_EDGE_REPO_URL" ]; then
  NEXUS_EDGE_REPO_URL="https://github.com/anatolii-semochko/iot-nexus-edge"
fi

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
  -e "s|__NEXUS_EDGE_REPO_URL__|$NEXUS_EDGE_REPO_URL|g" \
  -e "s|__NEXUS_EDGE_VERSION__|$NEXUS_EDGE_VERSION|g"

cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
# .env additionally gets project-specific credentials .env.example
# deliberately leaves as generic placeholders (change-me) - only the
# ones a fresh `make up-all` needs to not immediately fail on.
sed -i \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=change-me|" \
  -e "s|^RABBITMQ_DEFAULT_PASS=.*|RABBITMQ_DEFAULT_PASS=change-me|" \
  "$TARGET_DIR/.env"

# Port defaults are a starting point, not guaranteed free (docs/
# CREATING_A_TARGET_PROJECT.md's "Known trap" section) - actually check
# now and move anything taken to the next free port, best-effort (a
# port free here can still race with something else before `make
# up-all` actually binds it).
"$TARGET_DIR/scripts/check-ports.sh" --assign

if [ ! -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" init -q
fi
git -C "$TARGET_DIR" add -A
if ! git -C "$TARGET_DIR" commit -q -m "Initial commit from nexus-edge make new-project ($NEXUS_EDGE_VERSION)"; then
  echo "WARNING: initial commit failed (likely no git user.name/user.email configured) - files are staged, commit manually: git -C $TARGET_PATH_RAW commit -m 'Initial commit'" >&2
fi

UI_PORT_FINAL=$(grep -m1 '^UI_PORT=' "$TARGET_DIR/.env" | cut -d= -f2)

cat <<EOF

Done. Next steps:
  cd $TARGET_PATH_RAW
  \$EDITOR .env               # review credentials - see the file's own
                              # header comment about checking for
                              # collisions with other running projects
  make up-all                 # build + start everything, including EdgeX

Then follow docs/CREATING_A_TARGET_PROJECT.md sections 5-7 (in this
nexus-edge checkout) to add your first DNP/command/UI plugin.
EOF

if [ -t 1 ]; then
  printf '\n\033[32mUI will be available at: http://localhost:%s\033[0m\n' "$UI_PORT_FINAL"
else
  printf '\nUI will be available at: http://localhost:%s\n' "$UI_PORT_FINAL"
fi
