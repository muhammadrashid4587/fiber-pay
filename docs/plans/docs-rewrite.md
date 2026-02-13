# Documentation Rewrite Plan (Fiber v0.6.1)

Last updated: 2026-02-12

Related baseline:

- `docs/plans/ai-payment-layer-intent.md` (agreed project intent and `@fiber-pay/agent` target role)

## Why rewrite now

Current docs mix multiple generations of command surface and package architecture.
The result is high cognitive load for both humans and agents:

- root docs still describe legacy CLI forms in several sections
- `skills/fiber-pay/SKILL.md` is not aligned with grouped CLI commands
- `@fiber-pay/agent` package has no package-level README, while `package.json` expects one
- capability statements are stronger than current implementation maturity in some places

## Product positioning (recommended single sentence)

`fiber-pay` is an AI-oriented execution layer for Fiber Network (v0.6.1), providing:

1. core protocol/RPC SDK (`@fiber-pay/sdk`)
2. local node/binary lifecycle management (`@fiber-pay/node`)
3. operational CLI (`@fiber-pay/cli`)
4. agent-friendly orchestration API + MCP tool schemas (`@fiber-pay/agent`)

## Source-of-truth policy

Set one canonical source per surface to stop future drift:

- CLI runtime and command behavior: `packages/cli/llm.txt`
- Agent API surface: `packages/agent/src/fiber-pay.ts`
- MCP schema surface: `packages/agent/src/mcp-tools.ts`
- RPC method compatibility: Fiber `v0.6.1` RPC reference

All high-level docs must link to these sources and avoid duplicating command details.

## Target doc IA (information architecture)

### 1) Root (`README.md`)

Keep root README as a concise entry page:

- what it is (positioning)
- who should use which package
- quick start (minimal happy path)
- link-out map to package docs and operator docs
- compatibility matrix (Fiber v0.6.1, Node version, network assumptions)

Avoid keeping long command references here.

### 2) Package docs

- `packages/sdk/README.md`: SDK-only usage and guarantees
- `packages/node/README.md`: binary/process lifecycle and operational caveats
- `packages/cli/README.md`: command groups and output policy summary; detailed behavior points to `llm.txt`
- `packages/agent/README.md`: `FiberPay` lifecycle, error model, MCP schema usage, known limits

### 3) Agent Skill docs (`skills/fiber-pay/*`)

Skill docs should be operator-task oriented and strictly command-accurate.
Any command examples must use grouped forms (`fiber-pay node start`, etc.).

## Rewrite order (lowest risk first)

1. `packages/agent/README.md` (missing file, high immediate value)
2. `skills/fiber-pay/SKILL.md` command refresh
3. root `README.md` reduce and relink
4. optional package READMEs for `sdk/node/cli`

## Execution status (2026-02-12)

- ✅ `packages/agent/README.md` created and aligned with current exports/status
- ✅ root `README.md` rewritten to intent-first entry doc
- ✅ `AGENT.md` rewritten to maintainer-facing intent/contract guide
- ⏸ `skills/fiber-pay/*` intentionally deferred (per sequencing decision)
- 🔜 next docs pass: `packages/sdk/README.md`, `packages/node/README.md`, `packages/cli/README.md`

## Editorial style rules

1. **Truth over aspiration**: describe implemented behavior first; roadmap second.
2. **One workflow per section**: bootstrap, receive, send, channel ops, troubleshooting.
3. **Dual output policy**: human default + `--json` for automation explicitly stated once.
4. **Error contract clarity**: include recoverable vs non-recoverable guidance.
5. **Version anchoring**: every behavioral doc states Fiber target (`v0.6.1`).

## Acceptance checklist

- [ ] No legacy top-level command examples remain
- [ ] All CLI examples are grouped-command style
- [x] `@fiber-pay/agent` has a package README that matches exports
- [x] Root README command examples match current implementation
- [ ] Skill docs use same command and output assumptions as CLI guide
- [ ] At least one end-to-end example each for receive/send/channel status

## Suggested follow-up automation

Add a lightweight docs consistency check script:

- scan for banned legacy command forms (e.g. `fiber-pay start`, `fiber-pay pay` if unsupported)
- verify required files exist (`packages/*/README.md`)
- fail CI when command drift is detected
