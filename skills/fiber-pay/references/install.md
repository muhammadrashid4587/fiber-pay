# Install (Local Build + Global Link)

This repository currently uses local build plus global linking for CLI usage.

## Prerequisites

- Node.js `>=20`
- `pnpm`
- `git`

## Install from source

```bash
git clone https://github.com/RetricSu/fiber-pay.git && cd fiber-pay
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

## Verify CLI is available

```bash
command -v fiber-pay
fiber-pay --version
fiber-pay -h
```

## Update after pulling new changes

```bash
git pull
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

## Notes

- This is a source-based developer/operator install path, not a package-registry release install.
- For exact command behavior and flags after install, use progressive help:
  - `fiber-pay -h`
  - `fiber-pay <group> -h`
  - `fiber-pay <group> <cmd> -h`
