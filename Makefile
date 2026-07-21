.PHONY: up down up-all down-all build logs ps restart edgex-up edgex-down sh

COMPOSE       := docker compose -f docker-compose.yml
COMPOSE_FULL  := docker compose -f docker-compose.yml -f docker-compose.edgex.yml

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
