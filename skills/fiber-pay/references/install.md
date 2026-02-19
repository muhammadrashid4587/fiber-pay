# Install

You can install from npm (recommended for consumers) or from source (recommended for contributors).

## Prerequisites

- Node.js `>=20`
- `pnpm`
- `git`

## Install from npm

```bash
pnpm add @fiber-pay/sdk
pnpm add @fiber-pay/runtime
pnpm add @fiber-pay/node
pnpm add @fiber-pay/agent
pnpm add @fiber-pay/cli
```

For CLI usage via package execution:

```bash
pnpm dlx @fiber-pay/cli --help
```

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

- npm release is tag-driven in CI (`.github/workflows/release.yml`) using `vX.Y.Z` tags.
- Stable tags publish to npm `latest`; pre-release tags (such as `-rc`) publish to `next`.
- For exact command behavior and flags after install, use progressive help:
  - `fiber-pay -h`
  - `fiber-pay <group> -h`
  - `fiber-pay <group> <cmd> -h`
