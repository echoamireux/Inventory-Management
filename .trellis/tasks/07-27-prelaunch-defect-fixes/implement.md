# 上线前缺陷修复 - Implementation Plan

## Preparation

- 分支：`codex/test-material-identity-governance`（沿用，不新建）
- 基线：`f54f5ee`，`npm test` 569/569，`preflight:deploy` 通过
- 开工前确认工作区干净：`git status`
- **先读 `prd.md` 的 `Confirmed Facts`**，尤其三条：B4 为何不能改索引、H1 为何放弃哨兵方案、事务内禁止 `where(...).update()`

## Implementation checklist

### 阶段一：阻断项（B1 / B2 / B3+B4）

- [ ] A1. `updateInventory/index.js:362` 的 `Math.floor(deduct * PRECISION) / PRECISION` 改为 `roundNumber(deduct, 3)`
- [ ] A2. 补单测：领用 `2.01` / `1.001` / `32.3` 的全额与部分领用，断言成功且 `remainingNeed` 归零
- [ ] A3. `miniprogram/pages/index/index.js` 的 `handleBatchWithdraw` 的 `withdrawItem` 补 `supplier_model: batch.supplier_model`
- [ ] A4. `approval-center/index.js:220` 补 `operation_id`（复用 `ensureOperationId`），成功后 `clearOperationId`
- [ ] A5. `approveMaterialRequest/index.js` 与 `approveInventoryCorrectionRequest/index.js` 的 `clearPendingKeyUpdate` 改为写 `done:${requestId}`；覆盖通过与驳回两条调用点
- [ ] A6. 补单测：连续两次审批（含一次通过 + 一次驳回）均成功，断言 `pending_key` 为唯一占位值而非缺失
- [ ] A7. **排查其余云函数调用方的参数契约** —— 逐一比对必填参数与前端传参，记录结果（无遗漏也要写明）
- [ ] A8. 阶段验证：`npm test` + `npm run preflight:deploy`

### 阶段二：日志字段（F1 / F2）

- [ ] B1. `_shared/` 新增 `buildInventoryLogIdentityFields(source)` 纯函数
- [ ] B2. 加入 `sync_shared.sh` 同步清单与 `deploy-preflight.js` 的 `sharedFiles`（若新建独立文件；若并入既有文件则确认该文件已在清单内）
- [ ] B3. `addMaterial/index.js:595` 的 `inboundLog` 补 `unique_code`（F1）
- [ ] B4. 10 个 `inventory_log` 写入点全部补三个身份字段：`addMaterial` ×2、`_shared/batch-add.js` ×1、`inventory-import.js` ×1、`editInventory` ×3、`updateInventory` ×1、`approveInventoryCorrectionRequest` ×1
- [ ] B5. 补单测：断言各类日志的字段形状（此前 569 个用例**无一断言入库日志字段**）
- [ ] B6. `npm run sync:shared`，确认副本一致
- [ ] B7. 阶段验证：`npm test` + `npm run preflight:deploy`

### 阶段三：测试料主数据级联（H3 / H4 / H5）

- [ ] C1. `manageTestMaterialIdentity:423` 编辑型号时重算并写入 `supplier_model_key` 与 `identity_key`（复用既有 key 生成逻辑，勿另写）
- [ ] C2. `manageMaterial:1101` 改 `product_code` 时检查 `test_material_identities`，存在型号则阻断并给明确提示
- [ ] C3. `manageMaterial:1412` 批量删除时同样检查型号，存在则阻断
- [ ] C4. **确认新增代码未使用 `transaction.collection(x).where(y).update()/remove()/count()`**
- [ ] C5. 补单测覆盖三条阻断/级联路径
- [ ] C6. 阶段验证：`npm test` + `npm run preflight:deploy`

### 阶段四：事务与幂等（H7 / H6 / H11）

- [ ] D1. `importInventoryTemplate/index.js:593` 的 `new Set()` 移入 `runTransaction` 回调内
- [ ] D2. 补单测：模拟事务重试，断言第二轮不会误判「本次提交内重复」
- [ ] D3. `operation-receipts.js` 区分技术异常与业务失败，仅对成功结果建立可复用回执
- [ ] D4. `material-add/index.js:1916` 业务失败后清除 `operation_id`（兜底）
- [ ] D5. **确认幂等原有语义未削弱**：重复提交同一笔成功操作仍返回首次结果，不重复扣减
- [ ] D6. 阶段验证：`npm test` + `npm run preflight:deploy`

### 阶段五：P1（H1 / H2 / 过期显示 / H8）

- [ ] E1. `loadTransactionWithdrawCandidates` 去掉「首页够量即 return」早退，读满候选后统一 `sortInventoryAllocationCandidates`
- [ ] E2. 补单测：混合有效期 + 超过单页容量的候选集，断言临期批次被优先扣减
- [ ] E3. `inventory-display.js:189` 的 `availableInputStock` 改为 3 位小数；`getInventoryGrouped` / `getInventoryBatches` 的 `totalQuantity` 同步对齐
- [ ] E4. `getInventoryExpiryAlertState` 按 `diffDays <= 0` 拆「已过期」/「临期」两档；领料弹窗对已过期批次加提示
- [ ] E5. **确认未禁止过期领用**（业务规则）
- [ ] E6. `exportLabelData:656` 把配额与频控校验前置于作废动作
- [ ] E7. 阶段验证：`npm test` + `npm run preflight:deploy`

## Validation commands

```bash
npm test
```

```bash
npm run preflight:deploy
```

```bash
npm run sync:shared
```

**预期**：测试数在 569 之上增加（至少 A2 / A6 / B5 / D2 / E2 五组新增用例）；预检通过；同步脚本退出码 0 且不产生意外变更。

### 事务约束自检（阶段三、四后必跑）

```bash
grep -rnE "transaction\s*\.\s*collection\([^)]*\)[^;]*\.(update|remove|count)\s*\(" cloudfunctions/ --include="*.js" | grep -v node_modules
```

预期无输出 —— 有输出即违反约束，必须改为 `doc(_id).update()` 形式。

## Risk points

- **B4 的占位值格式**一旦写入就成为历史数据形态，改格式需考虑存量。空库环境无此顾虑，但格式应一次定好
- **F2 抽公共函数**会改动 `_shared/`，务必跑 `sync:shared`，否则 `preflight:deploy` 的哈希校验会拦下
- **阶段三涉及事务内新增写**，是本次最容易违反事务约束的地方，C4 自检不可跳过
- **阶段四改幂等语义**风险最高：改过头会让重复提交产生重复扣减。D5 必须验证
- **H2 改动影响所有化材数量展示**，需确认「展示 2 位、可领用上限 3 位」并存不会让用户困惑（例如显示 0.00 但能领 0.003）
- 五阶段独立提交，任一阶段失败不影响其余阶段交付

## Rollback points

- 每阶段一次提交，`git revert` 单个提交即可回退该阶段
- 阶段二回滚须同时还原 `_shared/` 与各云函数副本（或重跑 `sync:shared`）
- 无数据库结构变更，无需数据回滚

## Deployment note

**需重新上传的云函数**：

`updateInventory`、`addMaterial`、`batchAddInventory`、`importInventoryTemplate`、`editInventory`、`approveMaterialRequest`、`approveInventoryCorrectionRequest`、`manageMaterial`、`manageTestMaterialIdentity`、`exportLabelData`

小程序端整体重新上传。

## Post-delivery：真机端到端验收清单

| # | 场景 | 验证点 |
|---|---|---|
| 1 | 化材领用 **2.01**（库存充足） | B1 —— 不再报「库存不足」 |
| 2 | 测试料按批次领料 | B2 —— 能正常领出 |
| 3 | 物料申请**连续审批两条**（一通过一驳回） | B3 + B4 —— **第二条必须成功**，只审一条验不出 B4 |
| 4 | 单件入库后进标签详情看日志 | F1 —— 能看到「初始录入」，且纠错入口可点 |
| 5 | 同产品代码下两个原厂型号各领用到同一项目 | F2 —— 项目用料汇总应为**两行**而非合并 |
| 6 | 编辑测试料原厂型号 → 再入库 | H3 —— 型号仍可正确选中 |
| 7 | 对有型号的测试料改产品代码 / 批量删除 | H4 / H5 —— 应被阻断并给出明确提示 |
| 8 | 模板导入多行（可重复几次） | H7 —— 不出现「标签编号在本次提交内重复」误判 |
| 9 | 提交一次会业务失败的申请 → 修正后重提 | H6 / H11 —— 修正后应能提交成功 |
| 10 | 领用尾数极小的化材批次（如 0.003） | H2 —— 能领空并转为已用完 |
| 11 | 查看已过期批次 | 过期显示 —— 徽标为「已过期」，**且仍可领用** |
| 12 | 预打印作废重做（触发配额限制） | H8 —— 原批不应在校验失败时已被作废 |
