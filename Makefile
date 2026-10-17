.PHONY: up down logs migrate seed test
up:
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs --tail=100 app
migrate:
	docker compose exec app npm run db:migrate
seed:
	docker compose exec app npm run db:seed
test:
	npm run typecheck && npm test
