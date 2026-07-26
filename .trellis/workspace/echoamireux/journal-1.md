# Journal - echoamireux (Part 1)

> AI development session journal
> Started: 2026-07-23

---



## Session 1: 主数据搜索体验与标签打印规则收尾

**Date**: 2026-07-24
**Task**: 主数据搜索体验与标签打印规则收尾
**Branch**: `codex/test-material-identity-governance`

### Summary

完成主数据管理页面与全局搜索体验改造，新增测试料型号独立导入页，统一测试料型号入口；同时优化标签打印默认模板顺序，收紧预生成标签选择器与正式料原厂型号主数据约束，并完成测试、部署预检和中文业务提交。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `33040b7` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 测试料主数据与型号库体验优化

**Date**: 2026-07-24
**Task**: 测试料主数据与型号库体验优化
**Branch**: `codex/test-material-identity-governance`

### Summary

完成测试料主数据代码壳与测试料型号库职责拆分：主数据页字段收敛并默认测试料名称/子类别，新增测试料型号独立页面和下拉产品代码，型号库 supplier 选填字段、三列导入模板、相似型号空格忽略提醒，以及入库/批量入库/模板导入/标签预打印默认供应商联动。验证通过 npm test、git diff --check、npm run preflight:deploy。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `120c37e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 统一物料管理与导入模板收尾

**Date**: 2026-07-25
**Task**: 统一物料管理与导入模板收尾
**Branch**: `codex/test-material-identity-governance`

### Summary

统一物料管理入口与测试料有效名称维护；补齐测试料入库/标签/库存展示快照规则；移除独立测试料型号批量导入路径；完善物料主数据导入页面、Excel 模板说明和测试料原厂型号必填提示；通过 npm test、git diff --check 与 npm run preflight:deploy。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `60e3502` | (see git log) |
| `2590b60` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 测试料型号远程分页搜索收尾

**Date**: 2026-07-25
**Task**: 测试料型号远程分页搜索收尾
**Branch**: `codex/test-material-identity-governance`

### Summary

完成测试料型号选择器云端分页搜索，覆盖标签打印、单个入库、批量入库和维护列表；同步测试料动态展示、日志报表取值、前端规范和回归测试，并通过 npm test、git diff --check、preflight:deploy 验证。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `7fe4385` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 上线前一致性风险修复

**Date**: 2026-07-25
**Task**: 上线前一致性风险修复
**Branch**: `codex/test-material-identity-governance`

### Summary

完成测试料入库精确校验、相似型号检查、发布 readiness 门槛、审批幂等和关键错误处理加固；验证 npm test、git diff --check、preflight 通过，release:check 按预期因缺正式库确认文件阻断。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `ed6b7a2` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 上线前代码审查与两轮质量修复

**Date**: 2026-07-26
**Task**: 上线前代码审查与两轮质量修复
**Branch**: `codex/test-material-identity-governance`

### Summary

完成上线前只读审查（4 版修订，撤回事务内 where 的阻断误判），实施两轮修复：超管自我降级防护、gitignore 误伤业务代码目录、调试日志清理、导入解析前置拦截、纠错审批日志扫描优化、事务垫片注释、下线 searchInventory。release:check 三道门禁全部通过。

### Main Changes

### 背景

本次会话从一次上线前只读代码审查开始，最终演进为「审查 → 交叉复核 → 两轮修复 → 通过发布门禁」的完整闭环。审查报告历经 4 版修订，其中最重要的一次是**撤回了自己提出的头号阻断结论**。

### 审查结论的关键反转（对后续维护最有价值的部分）

初版审查依据微信云开发官方文档的表述——「事务中不支持批量操作（where 语句），只支持单记录操作」——把「32 处云函数事务内使用 `where()`」列为阻断上线的首要问题。

经解包项目实际依赖的 SDK 源码后**该结论被推翻**：

- 依赖链 `wx-server-sdk@3.0.4` → `@cloudbase/node-sdk@2.10.0` → `@cloudbase/database@1.4.1`
- 该包内存在**两套 Transaction 实现**：旧的 `dist/commonjs/transaction.js` 没有 `collection()` 方法（官方文档描述的就是它），新的 `dist/commonjs/transaction/index.js` 有，且 `index.js:8` 实际 require 的是新实现
- 逐方法核对：`Query.where/orderBy/limit/skip/field/options/get` 与 `DocumentReference` 全部方法均透传 transactionId；**唯独 `Query.update` / `Query.remove` / `Query.count` 不透传**
- 全项目扫描：事务内含 `where` 的链终结方法全部是 `.get()`（30 处），危险的 where 型写操作 0 处

**结论**：事务用法是安全的。真正需要警惕的是 `transaction.collection(x).where(y).update()/remove()/count()` —— 这类写会静默脱离事务且不随 rollback 回滚。该约束已写入任务 prd.md 与 `updateInventory` 的代码注释。

**方法论教训**：官方文档与实际 SDK 实现不一致时，以解包后的实现为准。过程中一个复核代理曾"实测"证明会崩溃，但它是自己构造了一个「只有 doc/add 的 transaction double」再证明该假设下会崩，属循环论证——验证必须针对生产依赖链上的真实对象。

### 偶然发现的严重问题

清理 `miniprogram/pages/logs/index.js` 的调试日志时，改完的文件未出现在 `git status` 中。追查发现 `.gitignore` 的 `logs` 规则**不带前导斜杠会匹配任意层级同名目录**，误伤了业务代码目录 `miniprogram/pages/logs/`。

该目录 4 个源文件自创建起从未进入版本库，而 `app.json:7` 注册了 `pages/logs/index` —— **任何人 clone 仓库都会缺失该页面**。核对 29 个注册页面，缺失的恰好只有这一个。

已改为 `/logs` 锚定根目录并将文件纳入版本控制。这类问题只有在恰好编辑该目录内文件并核对 git 状态时才会暴露。

### 两轮修复内容

**第一轮（26d6eb5）**

- 超管自我降级防护：`updateUserRole` 此前只校验「是否导致零个超管」，未校验「是不是在改自己」。补上防护，位置与 `updateUserStatus` 的语句顺序对称
- 顺带澄清既有测试：`a super administrator can be demoted when another active super administrator remains` 的 mock 操作人是 `openid-super-1`，降级目标恰好也是 `super-1`，实为在测「降自己」。改为降 `super-2` 并加注释，另补自我降级被拒的新用例
- `.gitignore` 误伤修复（见上）
- 清理 4 处调试 `console.log`；`console.error`/`warn` 全部保留
- 错别字修正、`batch-entry.js` 的 `suggestionTimer` 补入 `onUnload` 清理

**第二轮（0e8fa47）** —— 系统尚无业务数据，风险最低，故将原定「上线后迭代」的四项提前处理

- 导入解析前置拦截：三条链路都有 100 行上限，但校验发生在解析之后。在解析器统一入口加 2MB 体积拦截，一处覆盖全部链路
- 纠错审批日志扫描：改为逐页判断、命中即返回、加 20 页上限。**初版曾尝试下推 `type` 过滤并改降序，被否决**——部分测试的 `command: {}` 不支持 `_.in`，且既有断言 `scannedSkips=[0,100]` 精确锁定了分页行为。方案演进已记入 design.md
- 事务替身垫片补注释（不删代码，13 处 mock 依赖它）
- 下线 `searchInventory`：133 行活代码但零前端调用方。连带清理 manifest、`sync_shared.sh` 三条 cp、README、两处测试，并加防复活断言与发布门槛条目

### 两处对自己先前定性的更正

- **C4 高估**：`loadAllInventoryLogs` 按 `inventory_id` 过滤，拉的是单条库存的日志而非全表，真实风险低于报告所述的「唯一数据量增长隐患」
- **C6 定性有误**：`updateInventory` 那句英文注释经核实是**正确的**，误导来自「存在兜底」这一事实本身。故改为写明而非删除

### 交付状态

- `npm run release:check` 三道门禁全部通过：566 测试 + 发布预检 + 环境配置与正式库门槛（集合 18/18、索引 35/35、ACL、废弃函数 4 项）
- 发布人已完成：云端删除 `searchInventory`、重新上传 `adminUpdateUserStatus` 与 `approveInventoryCorrectionRequest`、补齐 `release-readiness.json`
- **剩余**：测试环境端到端走查。重点为搜索（`getInventoryGrouped` 接替下线的 `searchInventory`，影响面最大）、纠错审批拒绝/通过两条分支、超管角色调整的自我保护

### 协作说明

审查报告最初写在 `~/.claude/plans/` 下，不在项目目录内。发布人指出换会话或换工具即丢失上下文，故要求写全 `design.md`/`implement.md` 并把审查结论沉淀进项目内的任务文档。该判断正确，相关内容现已随任务归档至 `.trellis/tasks/archive/2026-07/07-26-pre-release-quality-fixes/`。


### Git Commits

| Hash | Message |
|------|---------|
| `26d6eb5` | (see git log) |
| `0e8fa47` | (see git log) |
| `d57248a` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 人员权限页弹窗交互与样式修复

**Date**: 2026-07-26
**Task**: 人员权限页弹窗交互与样式修复
**Branch**: `codex/test-material-identity-governance`

### Summary

修复 action-sheet 取消按钮无响应（缺 bind:cancel）、Dialog 按钮不等分、危险操作红色确认按钮被全局 !important 覆盖三个缺陷。初版仅移除破坏性覆盖后实机仍偏移，经浏览器复现对照后改为显式声明等分。同步反转了一个锁定错误实现的测试，并清理 material-import 中同源的死代码。

### Main Changes

### 背景

上线前走查「人员与权限管理」页发现两个界面缺陷，排查中又牵出第三个。三者中后两个同源。同批走查确认：超管修改自己角色会被正确拒绝，任务 `07-26-pre-release-quality-fixes` 的 R1 防护生效。

### 缺陷与根因

**一、action-sheet 取消按钮点击无反应**

`user-manage/index.wxml` 设了 `cancel-text` 渲染出取消按钮，却只绑定 `bind:select` 与 `bind:close`，缺 `bind:cancel`。vant action-sheet 是受控组件，`show` 全靠外部改，而点取消触发的是 `cancel`（`action-sheet/index.js:68` 的 `$emit('cancel')`），没有处理器就复位不了 `show`。点遮罩和关闭图标走的是 `close`，所以表现为「只有取消按钮没反应」。

全项目 14 处 `van-action-sheet` 仅此一处受影响 —— 其余均未设 `cancel-text`，不渲染取消按钮。

**二、Dialog 确认按钮偏移**

`app.wxss` 中一段注释为「全局修复 Vant Dialog 按钮样式」的覆盖即问题源。它以 `!important` 重定义 `.van-dialog__button` 却丢掉了 vant 原生的 `flex: 1`，破坏等分。同段另有两条无效规则：`.van-dialog__footer--buttons` 在 vant 模板中不存在；`.van-dialog__button .van-button__text` 是跨组件后代选择器，小程序样式隔离下不生效。

关键前提：`common/component.js:45` 设 `addGlobalClass: true`，vant 组件允许全局样式穿透，故 app.wxss 确实作用到组件内部。另注意 `van-dialog__button` 是通过 **`class`**（非 `custom-class`）设在 `<van-button>` 组件节点上的。

**三、危险操作的红色确认按钮被强制成蓝色**

`.van-dialog__confirm { color: #1989FA !important }` 压过 van-button 的内联 style，使 `confirmButtonColor` 失效。影响四处，其中三处为危险操作：禁用账号 `#dc2626`、删除/归档物料两处 `#ee0a24`。

### 一次做法修正（本次最值得记录的部分）

初版（`fc654d6`）只移除了破坏布局的覆盖，依赖 vant 原生 `footer:flex` + `button:flex-1` 恢复等分。**实机验证仍偏移。**

为定位原因，用浏览器复现了 vant 的真实 DOM 结构与样式做对照，实测原生规则在标准 flex 下结果完全正确：两按钮各 160/320、文字中心零偏移，加不加 `min-width:0` 相同。**故问题不在 CSS 逻辑，而在「依赖组件库内部实现」这一做法本身不够稳妥。**

佐证：该布局在本项目已出现过两次失败的修复尝试（本次移除的 app.wxss 段落，以及 material-import 的 `.fix-dialog-style` 段落）。反复出问题的地方不该继续赌组件库内部实现。

改为显式声明（`bf8e6d4`），只做等分这一件事：

```css
.van-dialog__footer { display: flex !important; }
.van-dialog__button { flex: 1 1 0 !important; min-width: 0 !important; }
```

与原生等价但不依赖其实现。`flex-basis: 0` 配 `min-width: 0` 防止按钮被文字长度撑开（「取消」2 字与「确认执行」4 字并排的场景）。

### 一个实用判据

判断样式改动是否真正编译生效，看「禁用账号」确认按钮**是否为红色**，而非看居中。原因：被覆盖的 `#1989FA` 与业务设定的 `#2563eb` 同为蓝色、肉眼难辨；`#dc2626` 红色一目了然。本次即靠该判据确认改动已生效。

### 测试的处置

原有测试 `global Vant dialog buttons are centered with flex layout` **逐条断言那段错误覆盖必须存在**，包括那条不存在的类名 —— 当初加样式的人写了测试把错误实现锁死。

改写为守护正确约束：若 app.wxss 声明 `.van-dialog__button` 则必须保留 `flex` 等分，同时禁止三条历史错误（不存在的 `footer--buttons` 类、跨组件后代选择器、按钮颜色覆盖），并锁定 vant 原生布局以便组件库升级时提示复核。另补一条守护 action-sheet 的 `cancel-text` 与 `bind:cancel` 成对出现。

### 顺带清理

`material-import/index.wxss` 的 `.fix-dialog-style` 段落（21 行）为纯死代码：类名全项目无引用，选择器所需祖先类不存在，从未生效（页面虽配 `styleIsolation: 'shared'`，但缺承载元素）。已移除，避免后续排查再被误导 —— 本次即因其与 app.wxss 覆盖段高度相似而一度纳入怀疑。

清理后全项目仅存两条 Dialog 按钮样式，均在 app.wxss。

### 交付状态

三项验收均已实机验证通过。`npm test` 567/567、`preflight:deploy` 通过。无云函数改动，仅需重新上传小程序代码包。

app.wxss 原位置留有维护约束注释：改动必须保留 flex 等分、不得覆盖按钮 color、改前先比对 vant 原生定义。


### Git Commits

| Hash | Message |
|------|---------|
| `fc654d6` | (see git log) |
| `bf8e6d4` | (see git log) |
| `bc2cbb2` | (see git log) |
| `5cb75f4` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 上线前 13 项缺陷修复（含 4 个阻断项）

**Date**: 2026-07-27
**Task**: 上线前 13 项缺陷修复（含 4 个阻断项）
**Branch**: `codex/test-material-identity-governance`

### Summary

按 v4 审查报告分五阶段修复 P0+P1 共 13 项，另有 3 项计划外追加。四个阻断项（领用扣减浮点截断致 741 个数值报库存不足、测试料按批次领料 100% 失败、审批漏 operation_id、pending_key 唯一索引致第二次审批必失败）均已修复并补回归测试。实施中有三处方案偏离与一次自引入回归的修正。测试 569→582 全通过。

### Main Changes

### 背景

承接上一次全量上线前审查（22 个代理分六域深审 + 独立反驳验证 + 完整性批判 + 两轮外部复核，报告定稿至 v4）的修复实施。范围为 P0 + P1 共 13 项，另有 3 项计划外追加。

审查结论的关键一条：**4 个阻断项全部逃过了 569 个单测与三道门禁**，因为它们落在跨模块接缝上（前端调用方与云函数的参数契约、解析口径与扣减口径、代码与数据库索引语义），而现有测试都是模块内 mock 单测，结构性看不见接缝。

### 四个阻断项

1. **B1 领用扣减浮点截断**：解析侧用 `Math.round` 归一化到 3 位小数，扣减侧却用 `Math.floor`。`2.01*1000 = 2009.9999999999998`，floor 少扣 0.001，残留量触发「库存不足」误判，提示还会显示成「总可用 2.01，需求 2.01」这种自相矛盾的文案。枚举确认 0.001~100.000 区间内 **741 个数值**受影响，含日常常用的 `2.01` / `4.02` / `8.03` / `16.06` / `32.01` / `32.3`。

2. **B2 测试料按批次领料 100% 失败**：`handleBatchWithdraw` 构造 `withdrawItem` 时拷了 12 个字段却漏了 `supplier_model`。特别讽刺的是，按产品代码领用会被拦截并提示「请扫码标签或**选择明确批次**」—— 而它指的这条路恰好是坏的。

3. **B3 物料申请审批 100% 失败**：未传 `operation_id`，云函数强制校验非空，刷新也无效（前端根本不生成该参数）。同文件的纠错审批**已有**正确写法，只有物料申请这一处漏了。

4. **B4 pending_key 唯一索引冲突**：审批后用 `_.remove()` 删字段，而云开发官方文档明确「唯一索引下不允许两条以上该字段为空/不存在的记录」，控制台又无 sparse 选项（发布人截图确认）。**第 2 次审批必然 duplicate key**。

**B3 与 B4 是连环的**：审批此前 100% 失败，从未走到移除字段那一步，B4 因此被掩盖。只修 B3 会把故障从「第一次就失败」变成「第二次才失败」，更难排查 —— 必须同批修复，验证时必须连续审批两条。

### 三处方案偏离（都是实施中撞出来的）

1. **H6/H11 撤回后端方案**：改 `beginOperationReceipt` 让 `failed` 不再复用后，撞上 `tests/operation-receipts.test.js` 的「failed responses are terminal and reusable」。核对后确认那是**有意设计**（保证同一次提交的重复请求返回一致结果），且 `markOperationReceiptFailed` 与之成对存在。改后端会推翻该不变量并波及全部 9 个使用幂等回执的云函数，故撤回，改为前端在业务失败时清除 `operation_id`。

   关键区分：**只在拿到明确业务响应时清除，网络异常不清除** —— 后者请求可能已在服务端成功，保留编号才能靠幂等回执取回首次结果。

2. **H5 改为归档而非阻断**：原定「有型号则阻断批量删除」，实现时发现「有型号则归档」更好 —— 与既有的「有库存历史则归档」同一路径，既保住关联又不打断整批操作。

3. **H1 采用读满候选再排序**：明确不用哨兵日期方案（`expiry_date` 与 `is_long_term_valid` 在**五处**严格互斥，落地需区分输入层与存储层并改三条入库链路）。同时把「读满扫描上限」的处理从「一律抛错」改为「基于完整候选集判断」—— 否则恰好读满上限且够量的合法场景会被误判为「库存范围过大」。

### 自己引入又自己修掉的一个回归

H3 让编辑型号时重算 `supplier_model_key`，解决了唯一性绕过。但领用是拿**型号库的当前 key** 去匹配库存（`buildWithdrawCandidateWhere`），而库存存的是**入库当时**的 key：

| 时点 | inventory 的 key | 型号库的 key | 领用 |
|---|---|---|---|
| 入库 | ab-100 | ab-100 | 正常 |
| 改名后（仅重算 key） | ab-100 | ab-200 | **匹配不到** |

等于用一个同样严重的问题换掉了唯一性绕过。补上「已有库存时禁止改型号名」的保护才完整。选阻断而非级联更新库存：真正会改变 key 的等于换了一个型号，而历史库存是按旧型号入库的客观事实，不应被追溯改写。

### 外部复核提出的残余风险（核实后发现更顽固）

复核指出 `operation_receipts` 仍会复用 `failed` 回执，在「后端已写失败回执、响应因网络断开没送达」时重试仍会拿到旧失败，建议作为上线后低优先级优化。

核实后发现比描述更严重：`ensureOperationId` 的缓存**没有任何时效**且写在持久化 storage 里，**刷新页面、重启小程序都清不掉** —— 不是「可能卡住」，而是除非改内容或清缓存否则**永久卡住**。故当轮修复：给编号加 30 分钟时效。该值远长于「响应丢失后立即重试」的窗口，不削弱幂等保护；而隔半小时才重新发起的操作，用户意图更可能是重新提交。

### 一处容易被忽略的排版问题

物料目录空状态文案改正后仍折成两行且断在动宾结构中间。根因是宽度而非文案：vant 给 `.van-empty__description` 设了 `padding: 0 60px`，叠加全局 `.van-empty` 的左右 20px，375px 屏幕上文字仅剩 215px（约 15 个汉字）。

实测三种方案后确认**只有「缩短文案 + 放宽间距」能单行展示** —— 单纯放宽间距会让 26 字变成 20+6 的断法，尾行只剩 6 字，比原来更难看。

### 交付状态

- `npm test` **582/582**（基线 569，净增 13 条覆盖用例）
- `npm run preflight:deploy` 通过
- 事务约束自检：全项目 `transaction.collection(x).where(y).update()/remove()/count()` **0 处**
- 代码侧验收全部通过；**七项依赖真机端到端的验收待发布人执行**

### 需重新上传的云函数

`updateInventory`、`addMaterial`、`batchAddInventory`、`importInventoryTemplate`、`editInventory`、`approveMaterialRequest`、`approveInventoryCorrectionRequest`、`manageMaterial`、`manageTestMaterialIdentity`、`exportLabelData`

小程序端整体重传。云端**无需新增集合或索引** —— 本次仅使用既有的 `test_material_identities` 与 `preprint_daily_usage`，均在已确认的 18 个集合清单内。

### 真机验收的两个易漏点

- **审批必须连续做两条**，只审一条验不出 B4
- **领用特意试 2.01**，这是 B1 最典型的触发值


### Git Commits

| Hash | Message |
|------|---------|
| `bf2643a` | (see git log) |
| `460cf42` | (see git log) |
| `9c83e09` | (see git log) |
| `9c1a97a` | (see git log) |
| `56d87ee` | (see git log) |
| `80b9265` | (see git log) |
| `8999004` | (see git log) |
| `184eb6c` | (see git log) |
| `ea71046` | (see git log) |
| `89655d3` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
