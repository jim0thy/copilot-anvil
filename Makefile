.PHONY: build install dev-install uninstall clean

build:
	bun run build

install:
	bun run build:install

dev-install:
	bun run link

uninstall:
	rm -f ~/.local/bin/anvil ~/.local/bin/anvil-cli
	bun run unlink || true

clean:
	rm -rf dist
