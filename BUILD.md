# Build and Install

## Dev mode (linked, always up to date)

```bash
bun run link
anvil
anvil-cli
```

`anvil` and `anvil-cli` execute the current source tree, so edits are picked up immediately without rebuilding.

## Standalone binaries

```bash
bun run build
```

This compiles standalone executables to `dist/anvil` and `dist/anvil-cli`.

## Install standalone binaries

```bash
bun run build:install
# or
make install
```

This installs the compiled binaries to `~/.local/bin`.

## Updating during development

- Dev mode (`bun run link`): updates are automatic.
- Compiled mode: rerun `bun run build` (or `make build`) after changes.
