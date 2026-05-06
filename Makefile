.PHONY: install build dev run

install:
	@bun install

build:
	@bun run build

dev: install
	@bun run dev

run: install build
	@bun run prod
