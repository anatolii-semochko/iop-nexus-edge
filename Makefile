.PHONY: up down up-all down-all build logs ps restart edgex-up edgex-down sh new-project add-process-kind

COMPOSE       := docker compose -f docker-compose.yml
COMPOSE_FULL  := docker compose -f docker-compose.yml -f docker-compose.edgex.yml

## Bootstrap a new target project from templates/target-project/
## (extension points design, AGENTS_TO_DO.md 2026-07-29 "Фаза В") - see
## docs/CREATING_A_TARGET_PROJECT.md.
new-project:
	@sh scripts/new-project.sh

## Copy a process-kind template from devices/processes/<kind>/ into a
## target project's own plugins/<new-kind>/ (AGENTS_TO_DO.md 2026-08-14).
## Usage: make add-process-kind KIND=example-threshold-monitor TARGET=../nexus-edge-aquarium [NEW_KIND=tank-ph-monitor]
add-process-kind:
	@sh scripts/add-process-kind.sh "$(KIND)" "$(TARGET)" "$(NEW_KIND)"

## Platform services only (postgres, redis, rabbitmq, orchestrator, api, ui)
up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

## Platform + EdgeX Foundry stack
up-all:
	$(COMPOSE_FULL) up -d --build

down-all:
	$(COMPOSE_FULL) down

## EdgeX Foundry stack only
edgex-up:
	docker compose -f docker-compose.edgex.yml up -d

edgex-down:
	docker compose -f docker-compose.edgex.yml down

build:
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
