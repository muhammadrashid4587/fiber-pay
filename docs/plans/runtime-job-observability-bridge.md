# Runtime Job Observability Bridge Plan

Last updated: 2026-02-18
Status: Implemented

## Why this plan exists

当前 `@fiber-pay/runtime` 存在两条并行但未打通的状态通路：

1. **Monitor 通路（已打通）**：`monitor -> AlertManager -> stdout/webhook/websocket`
2. **Job 通路（未打通）**：`JobManager(EventEmitter) -> (no bridge)`

结果是：通过 Job 系统发起的 payment / invoice / channel 生命周期，在默认 stdout 日志中基本不可见；且 Job 发起的 payment/invoice 不会自动加入 tracker 追踪列表，导致后续状态变化告警缺失。

## Scope

### In scope

- 将 `JobManager` 事件桥接为 runtime alerts（统一进入已有告警后端）
- 补全 invoice tracker 对 `Expired` / `Cancelled` 的告警输出
- 让 Job 发起的 payment / invoice 自动注册到 tracker（store）
- 增加对应测试，保证映射和行为稳定

### Out of scope

- 不重构 `JobManager` 的核心执行模型
- 不新增独立日志系统（仍沿用 Alert backend 作为观测出口）
- 不引入新的跨包抽象层

## Observed gaps (as-is)

1. `alerts/types.ts` 已定义 `payment_job_*` 类型，但代码未发射。
2. 缺少 invoice/channel job 级别 alert type。
3. `service.ts` 未监听 `job:created|state_changed|succeeded|failed|cancelled`。
4. `invoice-tracker.ts` 仅在 `Received/Paid` 发 `incoming_payment_received`，未覆盖 `Expired/Cancelled`。
5. Job executor 直接 RPC，不经过 proxy 拦截逻辑，导致 tracker 自动追踪链路断开。

## Architecture decision

### Decision A: 在 `FiberMonitorService` 做 Job->Alert 桥接（而非 JobManager 内部）

理由：

- 保持 `JobManager` 只依赖 RPC + Store，维持职责单一。
- 复用 runtime 现有集成边界：`FiberMonitorService` 已是 monitors / alerts / proxy / jobs 的装配中心。
- 与已有 monitor 注入 `AlertManager` 的设计一致，改动面最小。

### Decision B: Job lifecycle alert 与 tracker state alert 并存

- Job lifecycle alert：回答“任务执行过程怎么样了”（started/retrying/succeeded/failed）
- Tracker state alert：回答“链上/节点状态变成什么了”（payment success/failed、invoice received/expired/cancelled）

两者互补，不互斥。

### Decision C: Job 侧自动注册 tracked items

- Payment job 在拿到 `payment_hash` 后调用 `store.addTrackedPayment(...)`
- Invoice job 在创建成功后调用 `store.addTrackedInvoice(...)`
- 利用 store 的幂等行为，避免重复追踪副作用

## Implementation plan

### Phase 1 — Alert type and payload extension

目标：补齐类型系统，保证后续桥接可类型安全落地。

- 更新 `packages/runtime/src/alerts/types.ts`：
  - 新增 invoice job alerts：
    - `invoice_job_started`
    - `invoice_job_retrying`
    - `invoice_job_succeeded`
    - `invoice_job_failed`
  - 新增 channel job alerts：
    - `channel_job_started`
    - `channel_job_retrying`
    - `channel_job_succeeded`
    - `channel_job_failed`
  - 新增 invoice tracker alerts：
    - `invoice_expired`
    - `invoice_cancelled`
  - 扩展 `alertTypeValues`
  - 新增 payload 接口：`InvoiceJobAlertData`、`ChannelJobAlertData`

验收：`AlertType` 与 `alertTypeValues` 一致，typecheck 无遗漏。

### Phase 2 — Job event bridge in service layer

目标：将 JobManager EventEmitter 事件转换为统一 alert。

- 更新 `packages/runtime/src/service.ts`：
  - 增加私有桥接逻辑（建议 `wireJobAlerts()`）
  - 监听事件：
    - `job:created` -> `*_job_started`（priority: low）
    - `job:state_changed` when `waiting_retry` -> `*_job_retrying`（priority: medium）
    - `job:succeeded` -> `*_job_succeeded`（priority: medium）
    - `job:failed` -> `*_job_failed`（priority: high）
  - `source` 统一为 `job-manager`

验收：通过 job API 创建/执行任务时，stdout/webhook/websocket 可收到对应 job alert。

### Phase 3 — Auto-track items created by job execution

目标：让 job 发起的 payment/invoice 进入 tracker 体系，持续产出状态告警。

- 在 service 层桥接中或 executor 完成路径中（优先 service 层最小入侵），
  - payment 产生 `paymentHash` 后 `addTrackedPayment`
  - invoice create/watch 产生 `paymentHash` 后 `addTrackedInvoice`

验收：job 发起后可在 `/monitor/list_tracked_payments|invoices` 中看到条目，后续状态变化可触发 tracker alert。

### Phase 4 — Invoice tracker alert completion

目标：补齐 invoice 终态观测。

- 更新 `packages/runtime/src/monitors/invoice-tracker.ts`：
  - 状态变更到 `Expired` 时 emit `invoice_expired`
  - 状态变更到 `Cancelled` 时 emit `invoice_cancelled`

验收：模拟 invoice 状态转换到 Expired/Cancelled 时，stdout 出现对应 alert。

### Phase 5 — Tests and regression guardrails

目标：确保映射规则可回归，避免后续 drift。

- 新增/扩展 runtime tests：
  - Job->Alert 映射测试（payment/invoice/channel + started/retrying/succeeded/failed）
  - Invoice tracker 对 Expired/Cancelled 的告警测试
  - Job auto-track 行为测试（tracked list + 终态告警）
- 执行：`pnpm typecheck && pnpm test && pnpm build`

验收：新增测试通过，现有测试无回归。

## Acceptance checklist

- [ ] Job lifecycle 在 stdout 可见（至少 started/retrying/succeeded/failed）
- [ ] payment/invoice/channel 三类 job 均有对等 alert 类型
- [ ] Job 发起 payment 后能进入 tracked payments 并触发 `outgoing_payment_*`
- [ ] Job 发起 invoice 后能进入 tracked invoices 并触发后续状态告警
- [ ] Invoice Expired/Cancelled 有独立 alert 类型与输出
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全通过

## Risks and mitigations

1. **重复告警噪音风险**：job succeeded 与 payment completed 可能连续出现。
   - 缓解：明确语义区分（job lifecycle vs state transition），source 区分为 `job-manager` / `payment-tracker`。

2. **状态映射不完整风险**：`job:state_changed` 涉及多状态。
   - 缓解：首版只映射稳定关键状态（waiting_retry），其余维持最小集，后续按需扩展。

3. **变更范围扩大风险**：改动 executor 会增加回归面。
   - 缓解：优先在 service 层桥接 + store 注入，尽量不侵入 executor 主逻辑。

## Rollout sequence (recommended)

1. 先合入类型扩展（Phase 1）
2. 再合入 service 桥接（Phase 2）
3. 再加 auto-track（Phase 3）
4. 补 invoice tracker（Phase 4）
5. 最后补测试并全量验证（Phase 5）

这样每一步都可独立验证并快速回滚。
