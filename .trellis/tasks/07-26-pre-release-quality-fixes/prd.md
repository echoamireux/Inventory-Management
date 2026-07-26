# 上线前质量修复

## Goal

在完成上线前完整代码审查后，修复审查发现的三项低风险质量问题（超管自我降级防护缺失、前端调试日志残留、错别字与 timer 泄漏），使系统在进入正式发布流程前不再携带已知的可修复缺陷。

同时把本次审查的关键结论沉淀进任务文档，使后续开发者（含新的 AI 会话）无需依赖原始对话即可理解系统现状、已排除的风险、以及尚未处理的待办。

用户价值：

- 超级管理员不会因误操作把自己降权后无法自行恢复。
- 生产环境不再输出无意义的调试日志，减少日志噪音与潜在的数据泄漏面。
- 批量入库页反复进出不再残留未清理的定时器。

## Confirmed Facts

### 审查基线（2026-07-26）

- 分支 `codex/test-material-identity-governance`，工作区干净。
- `npm test` 566/566 通过，耗时约 1 秒。
- `npm run preflight:deploy` 通过。
- `npm run release:check` 因缺少被 `.gitignore` 忽略的 `scripts/release-readiness.json` 而失败，这是**预期行为**，该文件是发布人在正式库确认后本地生成的凭证，不入版本库。
- 云端集合（18）、索引（35，含两个 `pending_key` 唯一索引）、核心集合 ACL「仅云函数可读写」、删除三个旧云函数（`login` / `initMDMCollection` / `exportTestMaterialIdentityTemplate`）—— 均由发布人在控制台确认完成。**本地只读审查无法独立验证云端状态**，以控制台与 `release-readiness.json` 为准。
- 已验证前端无任何对已删除云函数的残留调用；`tests/deployment-hardening.test.js` 与 `tests/test-material-identities.test.js` 中有断言这些函数不存在的「防复活」测试。

### 事务 SDK 行为（重要，曾导致误判）

审查初版曾把「云函数事务内使用 `where()`」列为阻断上线的首要问题，依据是微信云开发官方文档的表述：

> 「在事务中不支持批量操作（where 语句），只支持单记录操作（collection.doc, collection.add）」

**该结论已撤回。** 经解包项目实际依赖的 SDK 源码确认，官方文档描述的是一个已成死代码的旧实现。

依赖链：`wx-server-sdk@3.0.4` → `@cloudbase/node-sdk@2.10.0` → `@cloudbase/database@1.4.1`

该包内存在**两套 Transaction 实现**：

| 实现 | 路径 | `collection()` 方法 | 是否被使用 |
|---|---|---|---|
| 旧 | `dist/commonjs/transaction.js` | 无（仅单文档 API） | 死代码 |
| 新 | `dist/commonjs/transaction/index.js:25` | 有，返回携带 transactionId 的 `CollectionReference` | **实际走这个** |

`dist/commonjs/index.js:8` 显式 `require("./transaction/index")`。

逐方法核对 `query.js` / `document.js` 的 transactionId 传递情况：

| 方法 | 携带 transactionId | 含义 |
|---|---|---|
| `Query.where` / `orderBy` / `limit` / `skip` / `field` / `options` | 是（链式透传） | 链式查询安全 |
| `Query.get` | 是（发给 `database.getDocument`） | **事务内 where 读受事务保护** |
| `DocumentReference.get/set/update/remove/create` | 是 | 单文档读写受保护 |
| `Query.update` / `Query.remove` / `Query.count` | **否** | **真正的风险模式** |

**结论**：事务内 `where().get()` 是被支持且受保护的。真正危险的是 `transaction.collection(x).where(y).update(...)` 这类 where 型写操作 —— 它们不带 transactionId，会静默脱离事务且不随 rollback 回滚。

**当前代码扫描结果（安全）**：

```
事务内含 where 的链，终结方法：  .get() × 30    ← 全部是读
危险终结（update/remove/count）： 0 处
事务内终结方法总览：update 56 / add 27 / get 15 / set 1
                   （56 处 update 全部是 doc(id).update()，受事务保护）
```

**可复现验证命令**：

```bash
cd cloudfunctions/exportMaterialTemplate/node_modules/@cloudbase/database
grep -n "require.*transaction" dist/commonjs/index.js   # → ./transaction/index（新实现）
grep -n "collection" dist/commonjs/transaction.js       # → 无 collection 方法（旧实现，死代码）
grep -n "_transactionId" dist/commonjs/query.js         # → where/orderBy/limit/skip/get 全透传
```

**维护约束**：后续新增事务内代码时，**禁止使用 `transaction.collection(x).where(y).update()/remove()/count()`**。需要条件写时，应事务外查候选取 `_id`，事务内用 `doc(_id).get()` 复核后再 `doc(_id).update()`。

**方法论教训**：官方文档与实际 SDK 实现不一致时，以解包后的实际实现为准。

### 其他已核实安全的部分

- 小程序端零直连数据库，所有数据操作走云函数。
- `miniprogram/env.js` 从未进入任何提交（`git log --all --pretty=format: --name-only | sort -u | grep -F "env"` 仅输出 `env.example.js`）。
- 33 份 `auth.js` 副本 MD5 全部一致（`e2d5c70e...`），`sync_shared.sh` 同步机制有效。
- 新用户注册硬编码 `role:'user'` + `status:'pending'`，无自助提权路径，无「首个用户自动成为超管」。
- `removeLog` / `batchRemoveLog` / `removeInventory` 已停用为返回友好错误的存根 —— **保留是正确的**，老版本小程序仍在用户设备上，直接删除会导致「函数不存在」。
- 并发领用同一批次不会超卖：快照隔离 + 写冲突检测，后提交的事务直接失败而非静默覆盖。
- `operation_receipts` + SHA256 签名的幂等机制完整。
- 35 个云函数除注册/登录外全部校验身份与角色，OPENID 均取自 `cloud.getWXContext()`，无客户端信任。

### 审查发现的其余四项（第二轮已全部处理）

审查原本把这四项列为"上线后迭代"。因系统尚无业务数据、改动风险处于最低点，发布人决定在同一批次内一并处理，见 R5–R8。

| 编号 | 问题 | 原定性 | 处理 |
|---|---|---|---|
| C3 | 三条导入链路均有 100 行上限（常量在 `utils/`），但解析发生在校验之前，超大文件仍可能卡住小程序端 | 低-中 | R5 |
| C4 | `approveInventoryCorrectionRequest` 在事务内 `while(true)` 分页拉取某库存全部日志 | 中 | R6 |
| C6 | 四个云函数的 `loadTransactionOperator` catch 只匹配 `unexpected transaction collection`，生产是死代码且缺少说明 | 低，但有误导性 | R7 |
| C7 | `searchInventory` 是活代码但无任何前端调用方 | 低 | R8 |

**对 C4 原定性的更正**：审查报告称其为「唯一与数据量增长相关的真实性能隐患」，此定性偏重。该查询按 `inventory_id` 过滤，拉取的是**单条库存**的日志而非全表；一条库存的日志量为「1 条入库 + N 次领用/补料」，领完即转 `used`，正常业务下 `while` 循环仅执行一次。真实风险远低于报告描述。

**对 C6 原定性的更正**：审查称 `updateInventory` 那句注释「production Cloud Database always supports the ordered query used above」具误导性。经 SDK 源码核实，**该断言本身是正确的**。真正的问题是「存在兜底」这一事实本身暗示了并不存在的兼容风险，而注释未说明该分支在生产为死代码。因此处理方式是把注释写明确，而非删除兜底。

## Requirements

### R1. 超级管理员不得通过角色调整降低自己的权限

- `adminUpdateUserStatus` 的 `updateUserRole` 分支必须拒绝「操作人 == 目标用户」且目标由 `super_admin` 降为其他角色的请求。
- 拒绝时返回 `{ success: false, msg: ... }`，文案风格与同文件 `updateUserStatus` 的自我保护提示一致。
- 既有的「系统必须至少保留一名激活的超级管理员」校验必须保留，两者是独立的防护。
- 超管调整**他人**角色的既有能力不受影响。
- 需有测试覆盖该拒绝路径。

### R2. 前端不得残留调试用日志

- 删除 `miniprogram/` 下 4 处明确的调试残留 `console.log`（`[Debug]` / `[Logs] Mapped List` / `onEdit triggered`）。
- **不得**删除 `console.error` 与 `console.warn` —— 它们是正常错误日志（前端 104 + 12 处，云函数 40 + 3 处），云函数侧的还可在云开发控制台查询。
- `cloudfunctions/searchInventory/index.js` 的 3 处 `console.log` 属 C7 范围，本次不动。

### R4. 修复 .gitignore 误伤业务代码目录（实施中发现，非原计划）

**发现经过**：实施 R2 时删除 `miniprogram/pages/logs/index.js` 的调试日志后，该文件未出现在 `git status` 中，排查发现整个目录未被版本控制跟踪。

**问题**：`.gitignore` 中的 `logs` 规则不带前导斜杠，会匹配**任意层级**名为 `logs` 的目录，因而误伤了业务代码目录 `miniprogram/pages/logs/`（库存日志页面，含 `index.js/json/wxml/wxss` 四个文件）。

**影响**：`miniprogram/app.json` 第 7 行注册了 `pages/logs/index`，但该页面源码从未进入版本库。任何人 clone 仓库后都会缺失该页面文件，而 app.json 仍引用它 —— 小程序构建或运行时会报错。经核对，29 个注册页面中恰有且仅有这 1 个在版本库中缺失。

**要求**：

- 将 `logs` 规则改为 `/logs`，使其仅匹配仓库根目录的运行日志目录。
- 将 `miniprogram/pages/logs/` 的四个源文件纳入版本控制。
- 根目录运行日志目录、`*.log` 文件的忽略行为必须保持不变。
- 确认无其他业务源码被 `.gitignore` 误伤（`miniprogram/env.js` 属有意忽略，不在此列）。

### R3. 修正错别字与定时器泄漏

- `miniprogram/app.js:109` 的 `身份校验对失败` 更正为 `身份校验失败`。
- `miniprogram/pages/material-add/batch-entry.js` 的 `onUnload` 需一并清理 `suggestionTimer`（当前仅清理了 `testMaterialIdentitySearchTimer`）。
- `app.js` 身份校验重试无次数上限一项**不修改** —— 已确认 `wx.showModal` 成功回调为异步执行、调用栈已释放，不存在堆栈溢出风险，仅是用户可反复点击重试，属可接受行为。

### R5. 导入必须在解析前拦截超大文件

- 在解析器统一入口 `parseImportTemplateFileBuffer` 增加文件体积上限，**先于**解析执行。
- 上限需明显高于 100 行模板的正常体积，只拦截异常量级的文件。
- 新增独立错误码并给出可操作的中文提示（含实际体积与上限）。
- 三条导入链路（物料导入、库存模板导入、批量入库）均通过该入口，一处生效即全覆盖。

### R6. 库存纠错审批不得在事务内无界拉取日志

- 「是否存在更晚的数量变更日志」是存在性判断，命中后必须立即返回，不再累积全部日志。
- 必须有分页上限；达到上限时保守判定为「存在后续操作」并拒绝自动纠错，不得继续扩大事务范围。
- 判定语义必须保持不变：仍由 `resolveLogTimestamp`（含 `create_time` 回退与非法时间戳归零）与 `isQuantityAffectingLogType`（含大小写归一化）在内存中完成。这两者无法用数据库查询等价表达，**不得下推到 where 条件**。
- 既有测试对分页行为的断言（`scannedSkips` 为 `[0, 100]`）必须继续成立。

### R7. 事务替身兼容垫片必须有明确说明

- 四个云函数（`addMaterial` / `batchAddInventory` / `importInventoryTemplate` / `updateInventory`）的 `loadTransactionOperator`（或 `getTransactionOperator`）catch 分支需加注释，说明该错误串仅由单测 mock 抛出、生产不会命中。
- `updateInventory` 中原有的英文注释改为中文并补全依据（具体 SDK 版本链、透传行为），同时写明 `Query.update/remove/count` 不透传 transactionId 这一维护约束。
- **不删除兜底代码** —— 13 处单测 mock 依赖它，删除需连带改造全部 mock，成本与收益不成比例。

### R8. 下线无调用方的 searchInventory

- 删除 `cloudfunctions/searchInventory/` 全部源文件。
- 同步清理：`cloudfunctions-manifest.json`、`sync_shared.sh` 的三条 `cp`、README 云函数清单、引用该函数的两处测试断言。
- 在 `tests/deployment-hardening.test.js` 增加防复活断言，与 `login` 等既有废弃函数一致。
- 加入 `release-check.js` 的废弃函数清单与 `release-readiness.example.json`，确保云端删除被纳入发布门槛。
- `sync_shared.sh` 必须仍能正常执行（该脚本带 `set -euo pipefail`，指向已删目录的 `cp` 会中断整个脚本）。
- `_shared/response.js` 予以保留（其唯一使用方虽已下线，但属通用 helper，删除超出本次范围）。

## Acceptance Criteria

- [x] `npm test` 全部通过。**最终 566/566**。基线为 566；第一轮新增 R1 覆盖用例后为 567，第二轮下线 `searchInventory` 时删除其专项测试，净数持平。（原验收条目写作「总数相比基线有增加」，仅适用于第一轮，此处按两轮合并后的实际情况修订。）
- [x] `npm run preflight:deploy` 通过。
- [x] 超管对自己执行降级操作返回明确的拒绝提示；对他人执行降级不受影响。
- [x] `grep -rn "console\.log" miniprogram/ --include="*.js" | grep -v miniprogram_npm | grep -v "\.min\.js"` 结果中不再包含 `[Debug]`、`[Logs] Mapped List`、`onEdit triggered` 三类调试输出。
- [x] `git ls-files miniprogram/pages/logs/` 返回四个源文件；`git check-ignore miniprogram/pages/logs/index.js` 退出码为 1（不再被忽略）。
- [x] `app.json` 注册的 29 个页面在版本库中全部存在。
- [x] 不修改任何事务逻辑、权限模型、库存数量模型。
- [x] 不提交 `scripts/release-readiness.json`。
- [x] `npm run sync:shared` 执行成功（退出码 0）且不产生意外文件变更。
- [x] 全仓库对 `searchInventory` 的残留引用仅剩注释、防复活断言与废弃函数清单三类。
- [x] `npm run release:check` 在发布人补齐 `removedCloudFunctions` 前，明确失败于「旧云函数清理未确认：searchInventory」；补齐后通过。**已确认两种状态均符合预期。**

## 交付状态（2026-07-26）

- 工作提交：`26d6eb5`（第一轮 R1–R4）、`0e8fa47`（第二轮 R5–R8）
- 发布人已完成：云端删除 `searchInventory`、重新上传 `adminUpdateUserStatus` 与 `approveInventoryCorrectionRequest`、补齐 `release-readiness.json`
- `npm run release:check` **三道门禁全部通过**：566 测试 + 发布预检 + 环境配置与正式库门槛（集合 18/18、索引 35/35、ACL、废弃函数 4 项）
- **待发布人执行**：测试环境端到端走查。重点为搜索（`getInventoryGrouped` 接替下线的 `searchInventory`，本次影响面最大）、纠错审批拒绝/通过两条分支、超管角色调整的自我保护

## Notes

- 本任务源自 2026-07-26 的上线前完整代码审查（历经 4 版修订、两轮第三方交叉复核）。
- 审查结论：**无阻断级问题**，可进入上线流程。
- 上述 `Confirmed Facts` 是审查结论的沉淀，后续会话应先读此节再动手，尤其是事务 SDK 一节 —— 它记录了一次已被推翻的误判，避免重蹈。
