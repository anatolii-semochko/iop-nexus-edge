#!/usr/bin/env bash
# Host-port availability for this target project (Пропозиція Е,
# AGENTS_TO_DO.md 2026-07-29 - originally deferred as "defaults + a
# reminder, no auto-scanning"; implemented 2026-07-31 once a second real
# target project needed it). Bash rather than sh - needs /dev/tcp and
# indirect variable expansion, both bash-only, and this whole toolchain
# already assumes a Linux dev machine (see new-project.sh's use of
# `realpath --relative-to`, GNU-only).
#
# Two modes:
#   --assign  used once by nexus-edge's own scripts/new-project.sh right
#             after .env is generated - probes each port, and if taken,
#             walks forward to the next free one and rewrites .env in
#             place. Best-effort: a port free at generation time can
#             still race with something else before `make up-all`
#             actually binds it - this is a starting point, not a lock.
#   --check   used by this project's own Makefile (check-ports target,
#             prerequisite of up/up-all/build, same warn-not-block
#             pattern as check-version) - warns about any of these ports
#             occupied by something OTHER than this project's own
#             already-running containers. Never rewrites .env.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env
if [ ! -f "$ENV_FILE" ]; then
  echo "check-ports: no .env file - nothing to check." >&2
  exit 0
fi

# Targeted grep/cut per var rather than `. ./.env` - .env is dotenv
# format (unquoted values, spaces allowed - e.g. PROJECT_NAME="Test
# House"), which is not valid POSIX shell assignment syntax when
# sourced directly. None of the vars this script reads (ports, SLUG)
# are ever expected to contain spaces, so this sidesteps the problem
# entirely rather than trying to be a general dotenv parser.
env_var() {
  grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-
}

SLUG=$(env_var SLUG)

PORT_VARS="POSTGRES_HOST_PORT ORCHESTRATOR_PORT API_PORT UI_PORT EDGEX_METADATA_HOST_PORT"

is_port_free() {
  # Plain TCP connect attempt via bash's /dev/tcp - no extra dependency
  # (nc/ss/lsof aren't guaranteed present; bash is). `timeout` guards
  # against an unlikely hang; loopback connects are otherwise instant.
  local port="$1"
  if timeout 1 bash -c "exec 3<>\"/dev/tcp/127.0.0.1/$port\"" 2>/dev/null; then
    return 1 # connected -> something is listening -> NOT free
  fi
  return 0 # connect failed -> free
}

owned_by_us() {
  # True if a container from THIS project's own compose project
  # (name = SLUG) publishes this port - i.e. it's our own already-
  # running stack, not a real collision.
  local port="$1"
  [ -n "${SLUG:-}" ] || return 1
  docker ps --filter "label=com.docker.compose.project=$SLUG" \
    --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"
}

# Ports already claimed earlier in THIS --assign run - is_port_free
# alone isn't enough within a single run, since a port just written
# into .env for one var has no process actually listening on it yet
# (nothing's been started), so a later var's own TCP probe would find
# it "free" and grab the same number (found 2026-07-31: ORCHESTRATOR_PORT
# and API_PORT both landed on the same reassigned port before this set
# existed).
CLAIMED=" "

is_claimed() {
  case "$CLAIMED" in
  *" $1 "*) return 0 ;;
  *) return 1 ;;
  esac
}

next_free_port() {
  local port="$1" tries=0
  while [ "$tries" -lt 50 ]; do
    if is_port_free "$port" && ! is_claimed "$port"; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
    tries=$((tries + 1))
  done
  echo "$1" # give up, hand back the original so callers still get *a* value
  return 1
}

mode="${1:-}"
case "$mode" in
--assign)
  changed=0
  for var in $PORT_VARS; do
    current=$(env_var "$var")
    [ -n "$current" ] || continue
    if is_port_free "$current" && ! is_claimed "$current"; then
      CLAIMED="$CLAIMED$current "
      continue
    fi
    if resolved=$(next_free_port "$current"); then
      echo "check-ports: $var=$current is taken, using $resolved instead."
      sed -i "s|^$var=.*|$var=$resolved|" "$ENV_FILE"
      CLAIMED="$CLAIMED$resolved "
      changed=1
    else
      echo "check-ports: WARNING - could not find a free port near $var=$current within 50 tries, leaving as-is - check manually before make up-all." >&2
    fi
  done
  [ "$changed" -eq 1 ] && echo "check-ports: .env updated."
  ;;
--check)
  for var in $PORT_VARS; do
    current=$(env_var "$var")
    [ -n "$current" ] || continue
    if is_port_free "$current"; then
      continue
    fi
    if owned_by_us "$current"; then
      continue
    fi
    echo "WARNING: $var=$current is already in use by something other than this project's own stack - check docker ps / docker compose ls before make up-all." >&2
  done
  ;;
*)
  echo "Usage: $0 --assign|--check" >&2
  exit 1
  ;;
esac
