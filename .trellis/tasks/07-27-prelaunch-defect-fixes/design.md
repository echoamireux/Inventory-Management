# 上线前缺陷修复 - Design

## Overview

13 项修复分五个阶段，按「阻断优先、同源聚合、独立可验」组织：

| 阶段 | 内容 | 性质 |
|---|---|---|
| 一 | B1 / B2 / B3+B4 | 阻断项，改动极小但影响面最大 |
| 二 | F1 / F2 | 日志数据完整性，涉及 10 个写入点 |
| 三 | H3 / H4 / H5 | 测试料主数据级联，需在事务内新增写 |
| 四 | H7 / H6 / H11 | 事务重试与幂等语义 |
| 五 | H1 / H2 / 过期显示 / H8 | P1，趁空库一并处理 |

阶段间无强依赖，可独立提交与回滚。唯一的顺序约束是 **B3 与 B4 必须同批**。

---

## 阶段一：阻断项

### D1. B1 — 扣减取整口径

**根因**：解析侧 `parseChemicalQuantity` 用 `Math.round(x*1000)/1000` 归一化（允许 3 位小数），扣减侧 `updateInventory/index.js:362` 却用 `Math.floor`。二进制浮点下 `2.01*1000 = 2009.9999999999998`，floor 得 `2.009`，少扣 `0.001`；残留量流到 `:427` 的 `if (remainingNeed > 0)` 抛「库存不足」。

**方案**：改用 `roundNumber(deduct, 3)`。

**为何安全**：`deduct = Math.min(currentStock, remainingNeed)`，两个入参本身都已是 3 位精度的规范值，round 后不会超过 `currentStock`。选 floor 的原意应是「宁可少扣不可超扣」，但在双方口径一致的前提下这个防御是多余的，反而制造了缺陷。

**影响面**：`0.001~100.000` 区间内 741 个数值受影响，其中一位小数 4 个（32.3 / 64.1 / 64.6 / 65.1）、两位小数 70 个（2.01 / 2.03 / 4.02 / 8.03 / 16.06 / 32.01 …）。

### D2. B2 — 批次领料补 `supplier_model`

**根因**：`handleBatchWithdraw` 构造 `withdrawItem` 时拷贝了 12 个字段，唯独漏了 `supplier_model`，导致 `payload.supplier_model` 为 `undefined`。云端 `updateInventory:292` 判定 `batch_no && is_test_material` 成立后，以空型号调 `loadTestMaterialIdentityForSelection` → 返回 `{ok:false, msg:'测试料请先选择已维护的原厂型号'}` → 直接失败。

**方案**：补一个字段即可，数据源 `getInventoryBatches:192` 已返回。

**附带说明**：测试料按产品代码领用会被 `shouldBlockTestMaterialProductOnlyWithdrawal` 拦下，提示语指向「选择明确批次」，而该路径恰好是坏的 —— 修复后这条指引才成立。

### D3. B3 + B4 — 审批链路

**B3 根因**：`approval-center/index.js:220` 只传 `request_id` / `action` / `reject_reason`，未传 `operation_id`；云端 `normalizeOperationId` 强制校验非空，直接抛「缺少操作编号，请刷新页面后重试」，而前端根本不生成该参数，刷新无效。

**B3 方案**：复用既有的 `ensureOperationId(scope, payload, action)` / `clearOperationId(scope)`，与首页领料 `index.js:490` 用法一致。

**B4 根因**：审批通过与驳回都调 `clearPendingKeyUpdate()`，用 `_.remove()` 移除 `pending_key`。而云开发唯一索引把缺失字段视为 `null` 且不允许两条以上为 null，控制台又无 sparse 选项 —— 第二次审批必然 duplicate key。

**B4 方案**：写唯一占位值代替移除。

```js
function buildPendingKeyClosure(requestId) {
  return { pending_key: `done:${requestId}` };
}
```

用 `requestId`（即记录 `_id`）保证唯一。保留 `done:` 前缀是为了让运维看数据时一眼分辨「已关闭」与「进行中」，也便于将来需要时按前缀筛选。

**为何不改索引**：控制台不提供 sparse 选项，无从配置；即使能配，把「防重复提交」这一业务约束的正确性寄托在索引细节上也不如代码显式表达。

**顺带排查**：B3 属参数契约类问题，须逐一比对所有云函数的必填参数与前端实际传参，确认无同类遗漏。

---

## 阶段二：日志字段补全

### D4. F1 — 单件入库补 `unique_code`

四个入库写入点中唯有 `addMaterial/index.js:595` 的 `inboundLog` 不写该字段。后果链条：`log-search.js` 按 `_.or([{unique_code}, {inventory_id}])` 检索 → 单件入库日志两个字段都对不上 → 标签详情页历史里没有「初始录入」→ 挂在 `type==='inbound'` 上的「发起纠错申请」按钮在标签维度不可达 → 审计事件的 `target.label` 退化为产品代码。

**方案**：补字段，与同文件 `:334` 的 `refillLog` 对齐。

### D5. F2 — 补三个身份字段

**写入点共 10 处**（审查报告中「5 处」为低估）：

| 文件 | 位置 |
|---|---|
| `addMaterial/index.js` | `:334` refillLog、`:595` inboundLog |
| `_shared/batch-add.js` | `:272` logData（供 batchAddInventory `:308` / `:387` 使用） |
| `importInventoryTemplate/inventory-import.js` | logData 构造（供 index.js `:723` / `:800` 使用） |
| `editInventory/index.js` | `:238` widthAdjustLog、`:278` stocktakeLog、`:323` transferLog |
| `updateInventory/index.js` | `:404` 出库 logs.push |
| `approveInventoryCorrectionRequest/index.js` | `:260` correctionLog |

**方案**：在 `_shared/` 新增一个纯函数统一构造，各写入点调用：

```js
function buildInventoryLogIdentityFields(source = {}) {
  return {
    supplier_model: source.supplier_model || '',
    supplier_model_key: source.supplier_model_key || '',
    batch_number: source.batch_number || ''
  };
}
```

**为何抽函数而非各处硬写**：10 个写入点分散在 6 个文件，硬写必然再漏；且将来新增日志类型时有统一入口。代价是共享文件改动后须跑 `npm run sync:shared`。

**取值来源**：三个字段在 `inventory` 记录上均已存在（入库时写入），出库/编辑/纠错场景直接从 `item` 取；入库场景从 `inventoryData` / `material` 取。无需新增数据来源。

**消费端受益**：`getLogs` 的 `LOG_SEARCH_FIELD_NAMES` 已含这三个字段（此前恒 0 结果）；`getProjectUsageReport` 的分组键含 `supplier_model_key || supplier_model`（此前恒空导致合并）；`log-item` 组件的原厂型号 UI 此前是死代码。

---

## 阶段三：测试料主数据级联

三项同源：主数据变更未级联到 `test_material_identities`。

### D6. H3 — 编辑型号时同步 key（含实施中发现的连带回归）

`manageTestMaterialIdentity:423` 更新原厂型号时只改 `supplier_model` 显示值，未重算 `supplier_model_key` 与 `identity_key`。后果：显示值与唯一键不一致，唯一性约束被绕过（可建出两条实质同型号的记录）。

**方案**：更新时按同一套规范化规则重算两个 key 并一并写入。须复用既有的 key 生成逻辑，不要另写一套。

#### 实施中发现：仅重算 key 会引入新的回归

领用时是拿**型号库的当前 `supplier_model_key`** 去匹配库存的：

```js
// updateInventory / buildWithdrawCandidateWhere
if (supplier_model_key) {
  where.supplier_model_key = supplier_model_key;
}
```

而库存记录里存的是**入库当时**的 key。因此一旦改名导致 key 变化：

| 时点 | `inventory.supplier_model_key` | 型号库的 key | 领用结果 |
|---|---|---|---|
| 入库时 | `ab-100` | `ab-100` | 正常 |
| 改名为 AB-200 后（**仅重算 key**） | `ab-100` | `ab-200` | **匹配不到，那批货领不出来** |

即：修复了唯一性绕过，却让历史库存失联 —— 换了一个同样严重的问题。而编辑路径原本**没有任何库存检查**。

**补充方案**：在 `identity_key` 将要变化时，先检查是否已有库存按旧 key 落库，有则阻断：

```js
if (candidate.identity_key !== current.identity_key) {
  const relatedInventoryRes = await transaction.collection('inventory')
    .where({ product_code: current.product_code, supplier_model_key: current.supplier_model_key })
    .limit(1).get();
  if (relatedInventoryRes.data && relatedInventoryRes.data.length > 0) {
    throw new Error('该原厂型号已产生库存记录，不能修改型号；如需变更请新建型号');
  }
  // ... 原有的唯一性冲突检查
}
```

**为何是阻断而非级联更新库存**：`supplier_model_key` 由 `supplier_model` 规范化派生，规范化后 key 仍不变的改动（仅调整大小写/空格）根本走不到这个分支；真正会改变 key 的等于**换了一个型号**，而历史库存是按旧型号入库的客观事实，不应被追溯改写。语义上应新建型号而非改名。

这与 D7（改产品代码时阻断）的处理一致。

### D7. H4 — 改产品代码时处理型号

`manageMaterial:1101` 改测试料代码壳的 `product_code` 时只检查 `inventory`，不检查 `test_material_identities`。若该测试料已维护型号但暂无库存，改代码后型号记录仍挂旧 `product_code` 与旧 `identity_key`，与新壳失配，该测试料彻底无法入库。

**方案**：二选一 —— (a) 级联更新型号记录的 `product_code` 与 `identity_key`；(b) 存在型号时直接阻断改代码并提示先处理型号。**推荐 (b)**：级联更新涉及重算 `identity_key` 并可能与既有记录撞唯一键，处理复杂度高；而改产品代码本身是低频运维动作，阻断并给出明确指引更安全。

### D8. H5 — 批量删除检查型号

`manageMaterial:1412` 批量删除只看 `inventory`，无库存即物理删除，留下孤儿型号记录。

**方案**：与 H4 一致 —— 删除前检查 `test_material_identities`，存在型号则阻断并提示。

### 事务约束（三项共同）

级联检查须在事务内完成以保证一致性，但**禁止 `transaction.collection(x).where(y).update()/remove()/count()`**（这三个方法不透传 transactionId，会静默脱离事务）。需要条件写时：事务外查候选取 `_id` → 事务内 `doc(_id).get()` 复核 → `doc(_id).update()`。只读检查用 `where().get()` 是安全的。

---

## 阶段四：事务重试与幂等

### D9. H7 — Set 移入事务回调

`importInventoryTemplate/index.js:593` 的 `const seenUniqueCodes = new Set()` 在 `runTransaction` 之外。事务自动重试时 callback 重新执行，Set 却保留上一轮数据，把自己第一轮写入的标签误判为「本次提交内重复」，整批入库失败。

**方案**：把 `new Set()` 移进 callback 内。

**范围澄清**：每次云函数调用都会新建 Set，故非永久失败；表现为「随机失败、重试有时又好」，排查成本反而更高。

### D10. H6 / H11 — 不缓存业务失败态

`operation-receipts.js:87` 把业务失败响应写入回执，重试时复用。用户修正条件后仍拿到旧的失败结果（范围限于同设备 + 同提交内容 + 同一缓存 `operation_id`）。

**最终方案：前端为主，不动后端语义。**

初版尝试改 `beginOperationReceipt` 让 `failed` 不再复用，但 `tests/operation-receipts.test.js` 有一条「operation receipt failed responses are terminal and reusable」明确断言该行为，且 `markOperationReceiptFailed` 与之成对存在 —— 这是有意设计而非疏漏：它保证同一次提交的重复请求（含网络重试）返回一致结果。改后端会推翻这一不变量并影响全部 9 个使用幂等回执的云函数，故撤回。

改为前端在**拿到明确业务失败响应时**清除 `operation_id`；网络异常仍走 catch 且不清除 —— 那种情况下请求可能已在服务端成功，保留编号才能靠幂等回执取回首次结果，清除反而会造成重复提交。

**注意**：无论怎么改，幂等的原有目的都不能被削弱 —— 重复提交同一笔成功操作仍必须返回首次结果，不能重复扣减。

#### 补充：编号时效（消除一个够不着的卡死场景）

前端清编号只覆盖「拿到了失败响应」的情况。还剩一个够不着的场景：

> 后端已写入 failed 回执，响应却因网络断开没能送达客户端。

此时前端走的是「网络异常」分支，按上面的设计**不清除**编号。于是用户重试时仍用同一个编号，后端把那条 failed 回执当作幂等结果返回。而编号缓存在持久化 storage 里，**刷新页面、重启小程序都不会清除**，用户只能靠改内容或清缓存自救。

**方案**：给 `ensureOperationId` 的缓存加 30 分钟时效。

| 场景 | 行为 |
|---|---|
| 相同内容、短时间内重试 | 复用编号 —— 幂等保护不受影响 |
| 内容变化 | 生成新编号（本就如此） |
| 超过 30 分钟后重试 | 生成新编号 —— 卡死自愈 |
| 早期版本写入的无时间戳缓存 | 补上时间戳后继续沿用，不立即作废 |

30 分钟远长于「响应丢失后立即重试」的窗口，因此不会削弱正常的幂等保护；而隔了半小时才重新发起的操作，用户意图更可能是重新提交而非期待幂等结果。

旧格式缓存不立即作废，是为了避免升级瞬间正在进行中的操作丢掉幂等保护。

---

## 阶段五（P1）

### D11. H1 — FEFO 读满候选再排序

`loadTransactionWithdrawCandidates` 按 `expiry_date asc` 分页，但「长期有效」记录不写 `expiry_date` 字段。数据库对缺失字段的排序位置无官方承诺，而本地比较器 `inventory-allocation.js:51` 明确规定「有有效期在前、无有效期在后」—— 两者方向相反，且本地排序只在页内生效。候选超过 100 条时，若首页恰好都是长期有效记录且量已够，函数直接早退，临期批次读都读不到。

**方案**：去掉「第一页够量即 return」的早退，读满 `MAX_WITHDRAW_CANDIDATES` 后统一 `sortInventoryAllocationCandidates`。

**为何不用哨兵日期**：见 prd.md `Confirmed Facts`（五处互斥校验）。

**代价**：候选读取量上升，但有 `MAX_WITHDRAW_CANDIDATES` 兜底，且仅在单产品在库标签数很大时才实际多读。相比「FEFO 静默失效」，这个代价可接受。

### D12. H2 — 化材可领用上限精度

`inventory-display.js:189` 把 `availableInputStock` 降到 2 位小数，而后端按 3 位存储。`<0.005` 的尾数被抹成 0，`withdraw-dialog` 的超领校验 `withdrawNum > stockNum` 拦下任何正数输入；而唯一能置 `used` 的路径是 `updateInventory` 的 `newStock === 0`，盘点与纠错都要求数量 > 0，删除入口已停用 —— 该标签既领不掉也清不掉。

**方案**：`availableInputStock` 保留 3 位，`displayQuantity` 维持 2 位仅用于展示；`getInventoryGrouped` / `getInventoryBatches` 的 `totalQuantity` 同理对齐。

### D13. 过期 / 临期两档显示

`checkInventoryExpiring` 用 `days <= 30` 判定，已过期的 `days` 为负数同样命中，徽标统一显示「即将过期」。全系统仅 `inventory-detail/index.js:152` 一处会追加「(已过期)」。

**方案**：`getInventoryExpiryAlertState` 按 `diffDays <= 0` 拆两档，返回可区分的 badge 文案与色调；领料弹窗对已过期批次给明确提示。

**业务规则**：不禁止领用，只让状态可见。FEFO 继续优先推荐最早过期的（符合先进先出），但用户须知情。

### D14. H8 — 作废重做顺序

`exportLabelData:656` 先作废原批、再校验配额与频控。校验失败时原批已不可逆作废且新批未生成，用户凭空损失一批预打印标签。

**方案**：校验前置 —— 先查配额与频控，通过后再执行作废与生成。

---

## Rollout / rollback

- 五阶段独立提交，可单独回滚
- 阶段二涉及 `_shared/` 改动，回滚时须同步回滚各云函数副本（或重跑 `sync:shared`）
- 无数据库结构变更；B4 的占位值写入对空库无迁移成本
- 需重新上传的云函数见 `implement.md`；小程序端整体重传
