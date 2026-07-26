# 上线前缺陷修复

## Goal

修复 2026-07-26 全量上线前审查发现的 4 个阻断项与 9 项高危缺陷，使系统从「日常路径存在硬失败」推进到「可进入真机端到端验收」的状态。

用户价值：

- 领用常见数量（如 2.01kg）不再莫名报「库存不足」
- 测试料可以按批次领料，物料申请可以连续审批
- 项目用料报表能正确区分同一产品代码下的不同测试料型号
- 主数据变更不会让已维护的测试料型号失联

## Confirmed Facts

### 审查基线

- 分支 `codex/test-material-identity-governance`，基线提交 `f54f5ee`，工作区干净
- `npm test` 569/569 通过，`npm run preflight:deploy` 通过，`npm run release:check` 三道门禁通过
- 云端集合(18)、索引(35)、ACL、旧云函数清理均已由发布人确认完成
- **当前为空库**，是做数据模型相关改动成本最低的时机
- 审查方式：22 个代理分六业务域深审 + 对高危发现独立反驳验证 + 完整性批判 + 两轮外部 AI 复核；4 个阻断项均已逐一亲自复现

### 四个阻断项为何能逃过所有防线

569 个测试全过、三道门禁全绿却一个都没拦住 —— 它们全部落在**跨模块接缝**上：前端调用方与云函数的参数契约、解析口径与扣减口径、代码与数据库索引语义。而现有测试都是模块内 mock 单测，结构性看不见接缝。这是当前测试体系的系统性盲区，不是个别疏漏。

### B4：为什么不能靠改索引解决（关键依据，本地代码看不出）

微信云开发官方文档明确：

> 「假如记录中不存在某个字段，则对索引字段来说其值默认为 `null`，如果索引有唯一性限制，则**不允许存在两个或以上的该字段为空/不存在该字段的记录**。」

且**云开发控制台的索引管理只提供「唯一/非唯一」，没有 sparse 选项**（已由发布人截图确认 `material_requests.uniq_pending_key` 与 `inventory_correction_requests.uniq_pending_key` 均为唯一索引）。

因此审批后用 `_.remove()` 移除 `pending_key` 的做法必然导致第二条记录冲突，**只能从代码侧解决**：写入唯一占位值而非移除。

### B3 与 B4 是连环的

当前审批因缺 `operation_id` 而 100% 失败，从未走到移除字段那一步，所以 B4 尚未暴露。**修好 B3 后第一次审批会成功、第二次立刻撞 duplicate key**。两者必须同批修复，否则只是把故障点往后挪一次，且更难排查。验证时必须连续审批两条。

### H1：为什么放弃「哨兵日期」方案

`expiry_date` 与 `is_long_term_valid` 在**五处**存在严格互斥校验：

- `addMaterial/index.js:217`
- `_shared/batch-add.js:70`
- `batchAddInventory/batch-add.js:70`
- `importInventoryTemplate/inventory-import.js:1081`
- `importInventoryTemplate/inventory-import.js:1292`

给「长期有效」写哨兵日期（如 `9999-12-31`）会违反该约束，要落地需区分「用户输入层」与「存储层」并改三条入库链路。展示端本身没问题（`inventory-display.js:50` 优先看 `is_long_term_valid`，不会显示成 9999/12/31），但这不改变入库侧的改造量。

故采用「读满候选再统一排序」方案：只动 `loadTransactionWithdrawCandidates` 一个函数，不碰数据模型、不碰校验、不碰存量数据。

### 事务使用约束（上一轮审查确认，必须遵守）

依赖链 `wx-server-sdk@3.0.4` → `@cloudbase/node-sdk@2.10.0` → `@cloudbase/database@1.4.1`。逐方法核对 `query.js` / `document.js` 后确认：

| 方法 | 携带 transactionId |
|---|---|
| `Query.where/orderBy/limit/skip/field/get` | ✅ |
| `DocumentReference.get/set/update/remove/create` | ✅ |
| **`Query.update` / `Query.remove` / `Query.count`** | ❌ **不携带** |

**事务内禁止 `transaction.collection(x).where(y).update()/remove()/count()`** —— 这类写会静默脱离事务、不随 rollback 回滚。需要条件写时应：事务外查候选取 `_id` → 事务内 `doc(_id).get()` 复核 → `doc(_id).update()`。

当前代码零处违反此约束，阶段三新增级联写时务必保持。

### 上一轮已确认安全、无需重复排查

事务内 `where().get()` 受事务保护；小程序端零直连数据库；`env.js` 从未提交；共享模块副本一致；新用户无自助提权；并发领用同一批次不会超卖（快照隔离 + 写冲突检测）。

### 业务规则确认

**实验室实际会使用过期物料**，因此允许录入和领用过期库存是正确设计，`f54f5ee` 移除入库端「过期日期不能早于当天」校验属有意放开。本次**不禁止过期领用**，只解决「已过期」与「临期」不区分的显示问题。

## Requirements

### R1. 领用扣减取整口径与解析侧一致（B1，阻断）

- `updateInventory` 扣减环节不得使用 `Math.floor` 截断，须与 `parseChemicalQuantity` 的 `Math.round` 口径一致。
- 修复后 `2.01`、`1.001`、`32.3` 等 741 个受影响数值的全额领用必须成功，且扣减后 `remainingNeed` 归零。
- 不得因改动导致扣减量超过实际库存。
- 需有测试覆盖。

### R2. 首页批次领料须传递原厂型号（B2，阻断）

- `handleBatchWithdraw` 构造的 `withdrawItem` 须包含 `supplier_model`（数据源 `getInventoryBatches` 已返回该字段）。
- 修复后测试料按批次领料须能正常完成，不再报「测试料请先选择已维护的原厂型号」。

### R3. 审批须传递操作编号（B3，阻断）

- 审批中心调用 `approveMaterialRequest` 时须传 `operation_id`，复用既有的 `ensureOperationId`，成功后清除。
- 须排查其余云函数调用方是否存在同类参数契约遗漏。

### R4. 审批后 pending_key 须保持唯一而非移除（B4，阻断）

- `approveMaterialRequest` 与 `approveInventoryCorrectionRequest` 的通过与驳回两条路径，均须将 `pending_key` 写为唯一占位值（如 `done:${requestId}`）而非 `_.remove()`。
- 修复后连续审批两条及以上申请不得失败。
- 不得试图通过修改索引解决（控制台不支持 sparse）。

### R5. 入库日志须包含标签编号（F1）

- `addMaterial` 单件入库日志须写入 `unique_code`，与补料、批量入库、模板导入三条路径保持一致。
- 修复后标签详情页的操作历史须能看到「初始录入」记录，其上的「发起纠错申请」入口随之可达。

### R6. 库存日志须包含测试料身份与批次字段（F2）

- 全部 10 处 `inventory_log` 写入点须补齐 `supplier_model` / `supplier_model_key` / `batch_number`。
- 修复后项目用料汇总须能区分同一产品代码下的不同原厂型号，不再合并成一行；按这三个字段的日志搜索须能命中。
- 三个字段在 `inventory` 与 `material` 上均已存在，不需新增数据来源。

### R7. 测试料主数据变更须级联到型号库（H3 / H4 / H5）

- 编辑原厂型号时，`supplier_model_key` 与 `identity_key` 须同步更新，唯一性约束不得被绕过。
- **同时**：当重算会导致 `identity_key` 变化、且该型号已有库存记录时，须阻断编辑。
  原因：领用是拿型号库的当前 `supplier_model_key` 去匹配库存，而库存存的是入库当时的 key；
  只重算 key 而不加这道保护，会让历史库存与型号库失配、那批货再也领不出来 ——
  等于用一个同样严重的问题换掉了唯一性绕过。详见 `design.md` D6。
- 修改测试料代码壳的 `product_code` 时，须同步或阻断，不得使已维护型号失联。
- 批量删除须检查 `test_material_identities`，不得留下孤儿型号。
- 级联写须遵守事务约束（禁止 `where(...).update()`）。

### R8. 事务重试不得误判标签重复（H7）

- `importInventoryTemplate` 的 `seenUniqueCodes` 须在事务回调内初始化，使每次重试从干净状态开始。

### R9. 幂等凭证不得缓存业务失败态（H6 / H11）

- 业务失败（非技术异常）不应写入可复用的成功回执，使用户修正条件后可以重新提交。
- 前端在业务失败后应清除 `operation_id` 作为兜底。

### R10. FEFO 不得依赖数据库对缺失字段的排序语义（H1）

- `loadTransactionWithdrawCandidates` 须读满候选后统一排序，去掉「第一页够量即返回」的早退。
- 不采用哨兵日期方案（理由见 Confirmed Facts）。

### R11. 化材可领用上限精度须与后端一致（H2）

- 前端 `availableInputStock` 须保留 3 位小数，与后端存储精度一致；展示用的 `displayQuantity` 可保持 2 位。
- 修复后 `<0.005` 的尾数库存须能被领空并转为 `used`，不得成为无法关闭的僵尸库存。

### R12. 已过期与临期须区分显示（过期显示）

- 按 `diffDays <= 0` 拆分为「已过期」与「临期」两档，视觉上可区分。
- 领料弹窗对已过期批次须给出明确提示。
- **不得禁止领用过期物料**（业务规则）。

### R13. 预打印作废重做须先校验后作废（H8）

- 配额与频控校验须前置于作废动作，避免校验失败时原批已不可逆作废而新批未生成。

## Acceptance Criteria

- [ ] `npm test` 全部通过，测试数在基线 569 之上有增加（至少覆盖 B1、B4、F2、H7）
- [ ] `npm run preflight:deploy` 通过
- [ ] 领用 `2.01` / `1.001` / `32.3` 不再报「库存不足」
- [ ] 测试料按批次领料可正常完成
- [ ] 物料申请**连续审批两条**均成功
- [ ] 单件入库后，标签详情页可见「初始录入」日志
- [ ] 同一产品代码下两个原厂型号的测试料，项目用料汇总显示为两行
- [ ] 修改测试料原厂型号 / 产品代码后，该测试料仍可正常入库
- [ ] 已过期批次的徽标显示「已过期」而非「即将过期」，且仍可领用
- [ ] 全项目无新增的事务内 `where(...).update()/remove()/count()` 用法
- [ ] 共享文件改动后 `npm run sync:shared` 执行成功且副本一致

## Notes

- 分五个阶段实施，每阶段独立验证与提交，便于单独回滚。详见 `design.md` 与 `implement.md`。
- 本次不处理：H9（全半角搜索）、F3（共享库区排序）、F4（申请记录分页）、F5（`utils/film.js` 脱离同步保障 + `utils/cst.js` 死文件）。
- 完整审查报告（含 46 项发现的证据链与被推翻的判断）见会话记录；关键结论已沉淀于本文档 `Confirmed Facts`。
