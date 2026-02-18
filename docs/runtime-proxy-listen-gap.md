# Runtime Proxy Listen 行为记录（待改进）

- 记录日期：2026-02-18
- 背景：多 profile / 多节点并行运行时，`runtime-proxy-listen` 的配置体验不一致，容易造成重复参数和端口冲突。

## 当前行为（as-is）

1. `fiber-pay node start` 默认使用 `--runtime-proxy-listen 127.0.0.1:8229`。
2. 如果启动时显式传入 `--runtime-proxy-listen`，该值会写入当前 data-dir（profile）下的 `runtime.meta.json` 的 `proxyListen` 字段。
3. `config profile` 不支持持久化该项（仅支持 `binaryPath`、`keyPassword`）。
4. 后续再次 `node start` 不会自动复用上次 `runtime.meta.json` 中的 `proxyListen`，仍回退到默认值（除非再次显式传参）。
5. `runtime stop` / `node stop` 会清理 runtime 元文件，导致该值不具备“配置级持久化”。

## 体验问题（why this feels wrong）

- 对同一 profile 的“稳定端口偏好”无法沉淀为配置，只能每次手动重复输入。
- 多节点场景下，用户需要记忆并重复维护多个 proxy 端口。
- `runtime.meta.json` 看起来像保存了可复用状态，但实际不作为下次启动配置来源，心智模型不一致。

## 影响场景

- 本地同时跑两个及以上节点（例如 `a/b` profile）。
- 自动化脚本、demo、e2e 流程中，启动命令需要重复附带端口参数。
- 用户期望“profile 级设置一次、长期生效”时会产生困惑。

## 建议改进（proposal）

### 方案 A（推荐）

在 `profile.json` 增加 CLI 级持久化键，例如：

- `runtimeProxyListen`: `127.0.0.1:8329`

并采用优先级：

1. CLI 参数 `--runtime-proxy-listen`
2. `profile.json.runtimeProxyListen`
3. 默认值 `127.0.0.1:8229`

### 方案 B（次选）

若不扩展 `profile.json`，至少在 `node start` 未显式传参时，尝试读取最近一次 `runtime.meta.json.proxyListen` 作为 fallback。

## 验收标准（建议）

1. 用户设置一次 profile 后，不再需要每次手动传 `--runtime-proxy-listen`。
2. 多 profile 并行启动不冲突（每个 profile 可有独立默认 proxy 端口）。
3. 文档明确区分：
   - 配置持久化（profile/config）
   - 运行态状态（runtime.meta）
4. `node start --json` 输出中可明确标识 `proxyListen` 来源（cli/profile/default）。

## 临时 workaround（当前版本）

- 启动时始终显式指定：

```bash
fiber-pay --profile a node start --runtime-proxy-listen 127.0.0.1:8229
fiber-pay --profile b node start --runtime-proxy-listen 127.0.0.1:8329
```

- 或在 shell 中封装别名，减少重复输入。
