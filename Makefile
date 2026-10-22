.PHONY: up down logs migrate seed test
up:
	node scripts/ops.mjs up
down:
	node scripts/ops.mjs down
logs:
	node scripts/ops.mjs logs
migrate:
	docker compose exec app npm run db:migrate
seed:
	docker compose exec app npm run db:seed
test:
	npm run typecheck && npm test
