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
