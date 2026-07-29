.PHONY: up down up-all down-all build logs ps restart edgex-up edgex-down sh check-version

COMPOSE       := docker compose -f docker-compose.yml
COMPOSE_FULL  := docker compose -f docker-compose.yml -f docker-compose.edgex.yml

# Version check (Фаза В extension points design, nexus-edge to-do.txt
# 2026-07-29) - simple exact-version comparison, warns and continues
# rather than blocking. Deliberately not a semver-range compatibility
# check - premature without more than one real target project to learn
# the actual shape of a compatibility break from.
check-version:
	@if [ -f .env ]; then set -a; . ./.env; set +a; \
	  if [ -f "$$NEXUS_EDGE_SOURCE_PATH/package.json" ]; then \
	    CURRENT=$$(grep -m1 '"version"' "$$NEXUS_EDGE_SOURCE_PATH/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/'); \
	    if [ -n "$$CURRENT" ] && [ "$$CURRENT" != "$$NEXUS_EDGE_VERSION" ]; then \
	      echo "WARNING: nexus-edge at $$NEXUS_EDGE_SOURCE_PATH is version $$CURRENT, this project was generated/last updated against $$NEXUS_EDGE_VERSION - review nexus-edge's changes before building."; \
	    fi; \
	  fi; \
	fi

## Platform services only (postgres, redis, rabbitmq, orchestrator, api, ui)
up: check-version
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

## Platform + EdgeX Foundry stack
up-all: check-version
	$(COMPOSE_FULL) up -d --build

down-all:
	$(COMPOSE_FULL) down

## EdgeX Foundry stack only
edgex-up:
	docker compose -f docker-compose.edgex.yml up -d

edgex-down:
	docker compose -f docker-compose.edgex.yml down

build: check-version
	$(COMPOSE_FULL) build

logs:
	$(COMPOSE_FULL) logs -f

ps:
	$(COMPOSE_FULL) ps

## Usage: make sh SERVICE=orchestrator
sh:
	$(COMPOSE_FULL) exec $(SERVICE) sh

restart:
	$(COMPOSE_FULL) restart
