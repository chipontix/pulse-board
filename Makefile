# Everything runs in Docker; Node 24 on the host is only needed for `make typecheck`.
COMPOSE ?= docker compose

.PHONY: help up down logs test e2e typecheck bench-page bench-sse

help:          ## this list
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-11s %s\n", $$1, $$2}'

up:            ## build and start the stack; status page on http://localhost:17380
	$(COMPOSE) up -d --build --wait

down:          ## stop this project's containers and delete its volumes (only project "pulseboard")
	$(COMPOSE) --profile test --profile e2e --profile tools down -v --remove-orphans

logs:          ## follow app and worker logs
	$(COMPOSE) logs -f app worker

test:          ## unit + integration tests in a container, against throwaway Postgres and Redis
	$(COMPOSE) --profile test build test
	$(COMPOSE) --profile test run --rm test npx vitest run
	$(COMPOSE) --profile test rm -sfv postgres-test redis-test

e2e: up        ## Playwright (Chromium) against the running stack, through the nginx edge
	$(COMPOSE) --profile e2e build e2e
	$(COMPOSE) --profile e2e run --rm e2e

typecheck:     ## tsc --noEmit on the host
	npx tsc --noEmit

bench-page: up ## public page with and without the cache, 3 interleaved reps -> results/page-*
	bench/run.sh page

bench-sse: up  ## SSE fan-out ladder until p95 delivery >= 500 ms, 3 reps -> results/sse-*
	bench/run.sh sse
