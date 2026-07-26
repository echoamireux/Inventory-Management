# 上线前质量修复 - Implementation Plan

## Preparation

- 分支：`codex/test-material-identity-governance`（沿用当前分支，不新建）
- 基线：`npm test` 566/566 通过，`npm run preflight:deploy` 通过
- 开工前确认工作区干净：`git status`
- 先读 `prd.md` 的 `Confirmed Facts` 节，尤其是事务 SDK 一节 —— 它记录了一次已撤回的误判，避免重复排查

## Implementation checklist

### A. 超管自我降级防护（D1）

- [ ] A1. 修改 `cloudfunctions/adminUpdateUserStatus/index.js` 的 `updateUserRole`：在既有「至少保留一名激活超管」校验**之后**，补入 `targetUser._openid === operatorOpenid` 的拒绝分支，消息为「不能降低当前登录账号的权限，请由其他超级管理员操作」
- [ ] A2. 确认顺序正确（先「至少保留一名」后「自我保护」），与同文件 `updateUserStatus:219-232` 的语句顺序一致
- [ ] A3. 澄清既有测试 `tests/approval-hardening.test.js:152` —— 把 `a super administrator can be demoted when another active super administrator remains` 的目标由 `super-1`（操作人自己）改为 `super-2`（他人），保持测试意图不变
- [ ] A4. 在 `tests/approval-hardening.test.js` 追加用例：多名超管存在时，超管降级自己应被拒绝，且 `state` 中角色不变
- [ ] A5. 确认 `the last active super administrator cannot be demoted`（139 行）与 `an active super administrator can promote another active user`（165 行）两个用例未受影响

### B. 清理调试日志（D2）

- [ ] B1. 删除 `miniprogram/pages/material-add/index.js` 第 1005、1010 行的 `[Debug]` 日志
- [ ] B2. 删除 `miniprogram/pages/logs/index.js` 第 466 行的 `[Logs] Mapped List` 日志
- [ ] B3. 删除 `miniprogram/pages/inventory-detail/index.js` 第 347 行的 `onEdit triggered` 日志
- [ ] B4. 确认删除后所在语句块语法完整（未破坏 `if` 单语句体等结构）
- [ ] B5. 确认未误删任何 `console.error` / `console.warn`

### C. 错别字与 timer（D3）

- [ ] C1. `miniprogram/app.js:109` 的 `身份校验对失败` 改为 `身份校验失败`
- [ ] C2. `miniprogram/pages/material-add/batch-entry.js` 的 `onUnload` 补入 `this.data.suggestionTimer` 的 `clearTimeout`
- [ ] C3. 确认未修改 `app.js` 的重试逻辑（该项明确不改）

### D. .gitignore 误伤修复（实施中发现，非原计划）

- [ ] D1. 将 `.gitignore` 的 `logs` 规则改为 `/logs`，并加注释说明不带前导斜杠会误伤业务目录
- [ ] D2. 确认 `git check-ignore -v miniprogram/pages/logs/index.js` 退出码为 1（不再被忽略）
- [ ] D3. 确认根目录运行日志目录仍被忽略：`git check-ignore -v logs` 应命中 `/logs`
- [ ] D4. 将 `miniprogram/pages/logs/` 四个源文件纳入版本控制
- [ ] D5. 核对 `app.json` 的 29 个注册页面在版本库中全部存在

### E. 导入解析前置拦截（D5）

- [ ] E1. `miniprogram/utils/import-file-parser.js` 新增错误码 `oversizedFile`、常量 `MAX_IMPORT_TEMPLATE_FILE_BYTES`、helper `resolveFileByteLength`
- [ ] E2. 在 `parseImportTemplateFileBuffer` 开头（`detectFileType` **之前**）加体积校验
- [ ] E3. `resolveImportTemplateErrorMessage` 补 `oversizedFile` 分支
- [ ] E4. 确认三条导入链路都经由该入口，无需逐页面改动

### F. 纠错审批日志扫描（D6）

- [ ] F1. `approveInventoryCorrectionRequest/index.js` 将 `loadAllInventoryLogs` 改为 `hasLaterQuantityAffectingLog`，逐页判断、命中即返回
- [ ] F2. 加 `LATER_LOG_PAGE_SIZE` / `LATER_LOG_MAX_PAGES`，达上限保守返回 `true`
- [ ] F3. **保持 where 条件与 `timestamp asc` 排序不变** —— 不要下推 type 过滤、不要改降序（见 design.md 方案演进）
- [ ] F4. 调用点改为 await 新函数，删除原内存 `some()` 判断
- [ ] F5. 确认 `scannedSkips` 为 `[0, 100]` 的既有断言仍通过

### G. 事务替身垫片注释（D7）

- [ ] G1. 为 `addMaterial` / `batchAddInventory` / `importInventoryTemplate` / `updateInventory` 四处 catch 补中文注释
- [ ] G2. `updateInventory` 的 `loadTransactionWithdrawCandidates` 英文注释改写，补依赖链与维护约束
- [ ] G3. **不删除任何兜底代码**

### H. 下线 searchInventory（D8）

- [ ] H1. 逐文件 `git rm` 六个源文件（`git rm -r` 会被安全策略拦截）
- [ ] H2. `cloudfunctions-manifest.json` 移除条目
- [ ] H3. `sync_shared.sh` 移除三条 `cp`，Response Helper 段落改注释
- [ ] H4. README 云函数清单移除条目
- [ ] H5. `tests/material-master-specs.test.js` 删除专项测试 + 从只读鉴权列表移除
- [ ] H6. `tests/deployment-hardening.test.js` 增加防复活断言
- [ ] H7. `release-check.js` 与 `release-readiness.example.json` 加入废弃清单
- [ ] H8. 执行 `npm run sync:shared` 确认退出码 0

## Validation commands

```bash
npm test
```

预期：全部通过，总数 > 566（新增 A4 用例）。

```bash
npm run preflight:deploy
```

预期：发布预检通过。

```bash
grep -rn "console\.log" miniprogram/ --include="*.js" | grep -v miniprogram_npm | grep -v "\.min\.js"
```

预期：不再出现 `[Debug]`、`[Logs] Mapped List`、`onEdit triggered`；`app.js` 中两处业务态日志（`新用户，跳转注册` / `用户状态:`）与 `index.js:312` 的 `扫码取消` 保留（属正常业务提示，非调试残留）。

```bash
git diff --stat
```

预期：仅 5 个文件变更（1 云函数 + 3 页面 + 1 app.js）加 1 个测试文件，共 6 个。

## Risk points

- **A3 是修改既有测试**，需在提交信息与 PR 描述中明确说明原因，避免被误读为「为了让测试通过而改测试」。判定依据见 `design.md` 的「既有测试的意图澄清」一节：该用例名称表达的意图是「非最后一名超管可降级」，目标选中操作人自己属疏忽。
- A1 的校验顺序若写反，`the last active super administrator cannot be demoted` 会因返回消息变化而失败 —— 若出现该失败，先检查顺序而非改测试。
- B 组删除行时注意行号会随删除而偏移，应按**从后往前**或按内容匹配的方式修改，不要按固定行号连续删除。
- D1 改动后 `adminUpdateUserStatus` 需重新部署到云端，仅上传小程序代码不生效。

## Rollback points

- A 组完成后可独立验证（`npm test`），失败则单独回退 `cloudfunctions/adminUpdateUserStatus/index.js` 与 `tests/approval-hardening.test.js`
- B、C 组为纯文本删除/修改，回退成本极低
- 三组之间无依赖，任一组失败不影响其余两组交付

## Deployment note

- 需重新上传云函数：`adminUpdateUserStatus`
- 小程序端需重新上传代码包
- 无数据库结构变更，无需在云开发控制台做任何操作
- **不提交** `scripts/release-readiness.json`（已被 `.gitignore` 忽略，由发布人在确认云端配置后本地生成）

## Post-delivery（交付后由发布人执行）

1. **在云开发控制台删除 `searchInventory` 云函数**（第二轮新增动作）
2. 在 `scripts/release-readiness.json` 的 `removedCloudFunctions` 数组补入 `"searchInventory"` —— 未补齐时 `release:check` 会明确失败于「旧云函数清理未确认：searchInventory」，这是设计意图
3. `npm run release:check` 跑三道门禁
4. **重新上传两个云函数**：`adminUpdateUserStatus`（第一轮 R1）、`approveInventoryCorrectionRequest`（第二轮 R6）
5. 重新上传小程序代码包
6. 测试环境端到端走查：注册 → 审批 → 入库（单条/批量/模板）→ 查询 → 领料（扫码/按代码）→ 纠错申请 → 审批 → 导出 → 标签打印
7. 上传审核

### 第二轮改动的重点验证项

- **导入**：正常 100 行内模板应照常导入；可另备一个超大 xlsx 验证是否给出体积超限提示而非卡死
- **纠错审批**：对一条有后续领用记录的库存提交纠错并审批，应仍拒绝并提示「已有后续业务操作」；对无后续操作的库存审批应正常通过
- **检索**：确认首页与库存页的搜索功能正常（`searchInventory` 下线后由 `getInventoryGrouped` 承担）
