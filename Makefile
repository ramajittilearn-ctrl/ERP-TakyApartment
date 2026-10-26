.PHONY: up down logs migrate seed test
up:
	node scripts/ops.mjs up
down:
	node scripts/ops.mjs down
logs:
	node scripts/ops.mjs logs
migrate:
	docker compose exec app node node_modules/prisma/build/index.js migrate deploy
seed:
	docker compose exec app node node_modules/tsx/dist/cli.mjs prisma/seed.ts
test:
	npm run typecheck && npm test
