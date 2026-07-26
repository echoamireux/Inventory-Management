# 上线前质量修复 - Design

## Overview

三项互相独立的低风险修复，不共享代码路径，可分别实施与回滚：

- **D1** 云函数侧：`adminUpdateUserStatus.updateUserRole` 补自我降级防护（含既有测试的意图澄清）
- **D2** 小程序侧：删除 4 处调试 `console.log`
- **D3** 小程序侧：错别字修正 + `onUnload` 补 timer 清理

不涉及事务逻辑、权限模型、库存数量模型的任何改动。

---

## D1. 超管自我降级防护

### 现状

`cloudfunctions/adminUpdateUserStatus/index.js` 有两个平行的写入分支，防护强度不一致：

| 分支 | 「至少保留一名激活超管」 | 「不能操作自己」 |
|---|---|---|
| `updateUserStatus`（禁用账号，196-232 行） | 有（220-228） | **有**（229-231） |
| `updateUserRole`（调整角色，138-194 行） | 有（155-163） | **缺失** |

后果：系统存在 2 名及以上激活超管时，超管 A 可通过 `updateRole` 把自己降为 `admin` 或 `user`，降级后不再具备超管权限，无法自行恢复，只能请另一名超管协助。属误操作风险。

### 方案

在 `updateUserRole` 的降级判定分支内补上自我保护，**放在既有的「至少保留一名」校验之后**，与 `updateUserStatus` 的语句顺序保持一致：

```js
if (targetUser.role === 'super_admin' && targetUser.status === 'active' && role !== 'super_admin') {
  const activeSuperAdminRes = await transaction.collection('users')
    .where({ role: 'super_admin', status: 'active' })
    .limit(2)
    .get();
  if ((activeSuperAdminRes.data || []).length <= 1) {
    return { success: false, msg: '系统必须至少保留一名激活的超级管理员' };
  }
  if (targetUser._openid === operatorOpenid) {
    return { success: false, msg: '不能降低当前登录账号的权限，请由其他超级管理员操作' };
  }
}
```

### 顺序为何重要

两条校验的先后顺序直接决定「唯一超管试图降级自己」时返回哪条消息：

- **先「至少保留一名」再「自我保护」**（本方案）：返回「系统必须至少保留一名激活的超级管理员」。既有测试 `the last active super administrator cannot be demoted` 断言的正是这条消息，顺序保持则该测试不受影响。
- 反序则该测试会因消息变化而失败。

同时这也与 `updateUserStatus` 既有的语句顺序一致，两个分支读起来对称。

### 依赖与影响面

- `operatorOpenid` 已是 `updateUserRole` 的第 4 个形参（由 `main` 传入 `cloud.getWXContext().OPENID`），无需修改函数签名或调用点。
- `targetUser._openid` 在事务内经 `doc(userId).get()` 读出，字段已存在。
- 不新增数据库访问，不改变事务边界。
- 返回结构 `{ success: false, msg }` 与该文件其余分支一致。

### 既有测试的意图澄清

`tests/approval-hardening.test.js:152` 的用例：

```js
test('a super administrator can be demoted when another active super administrator remains', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', ... },
    { _id: 'super-2', _openid: 'openid-super-2', ... }
  ]);
  const result = await mod.main({ action: 'updateRole', userId: 'super-1', role: 'admin' });
  assert.equal(result.success, true);
});
```

`loadAdminUpdateUserStatus` 的 mock 中 `getWXContext()` 返回 `{ OPENID: 'openid-super-1' }`，因此该用例操作的 `super-1` **正是操作人自己**。加上 D1 防护后它必然失败。

判断：该用例的**意图**由其名称明确表达 —— 「当还有另一名激活超管时，超管可以被降级」，验证的是「非最后一名超管可降级」这条规则，而非「可以降自己」。目标选中 `super-1` 属疏忽，与测试意图无关。

处理：把目标改为 `super-2`（他人），测试意图完整保留且表达更精确；不削弱任何既有断言。

另外两个相关用例不受影响：

- `the last active super administrator cannot be demoted`（139 行）：先命中「至少保留一名」，消息不变。
- `an active super administrator can promote another active user for a safe handover`（165 行）：目标是他人且为提权（`role === 'super_admin'`），不进入降级分支。

### 新增覆盖

在 `tests/approval-hardening.test.js` 追加用例，验证「有多名超管时，超管仍不能降级自己」，与被澄清的 152 行用例形成对照：一个验证降他人成功，一个验证降自己被拒。

---

## D2. 清理前端调试日志

### 方案

删除 4 行明确的调试输出，整行移除：

| 文件 | 行 | 内容 |
|---|---|---|
| `miniprogram/pages/material-add/index.js` | 1005 | `console.log('[Debug] Checking status for:', keyword)` |
| `miniprogram/pages/material-add/index.js` | 1010 | `console.log('[Debug] checkStatus res:', checkRes)` |
| `miniprogram/pages/logs/index.js` | 466 | `console.log('[Logs] Mapped List:', mappedList)` |
| `miniprogram/pages/inventory-detail/index.js` | 347 | `console.log('onEdit triggered', this.data.id)` |

### 边界

- **不动 `console.error` / `console.warn`**。前端 104 + 12 处、云函数 40 + 3 处均为正常错误日志，云函数侧的还可在云开发控制台检索，是线上排障的主要手段。
- `cloudfunctions/searchInventory/index.js:113-116` 的 3 处 `console.log` 归属 C7（该函数疑似应下线），本次不动，避免在未决定其去留时做无谓改动。
- 删除后需确认不破坏所在语句块的语法（如是否为 `if` 单语句体）。

---

## D3. 错别字与 timer 泄漏

### 错别字

`miniprogram/app.js:109`：`console.error('身份校验对失败:', err)` → `身份校验失败`。纯文案，无逻辑影响。

### timer 泄漏

`miniprogram/pages/material-add/batch-entry.js` 存在两个 timer，生命周期管理不对称：

| timer | 存放位置 | 设置处 | `onUnload` 清理 |
|---|---|---|---|
| `testMaterialIdentitySearchTimer` | `this`（实例属性） | 507 | 有（293-296） |
| `suggestionTimer` | `this.data`（页面数据） | 863 | **无** |

`suggestionTimer` 在搜索逻辑内部（838、881 行）有清理，但页面卸载路径未覆盖。页面销毁后回调触发会产生 setData 告警。

方案：在 `onUnload` 中补充清理。

```js
onUnload() {
    if (this.testMaterialIdentitySearchTimer) {
        clearTimeout(this.testMaterialIdentitySearchTimer);
        this.testMaterialIdentitySearchTimer = null;
    }
    if (this.data.suggestionTimer) {
        clearTimeout(this.data.suggestionTimer);
    }
},
```

只 `clearTimeout` 而不 `setData({ suggestionTimer: null })` —— 页面已进入卸载流程，此时 `setData` 无意义且可能触发额外告警。

### 明确不改的一项

`app.js:112-120` 身份校验失败后的重试无次数上限。审查已确认 `wx.showModal` 的 `success` 回调为异步执行、调用栈在回调触发前已释放，**不存在堆栈溢出风险**，仅是用户可反复点击重试按钮，属可接受的交互行为。加重试计数会引入「达到上限后用户无法自救」的新问题，收益为负。

---

## D4. .gitignore 误伤业务代码目录（实施中发现）

### 根因

`.gitignore` 原第 46 行：

```gitignore
logs
```

gitignore 语法中，**不含斜杠的模式会匹配任意层级的同名文件或目录**。因此该规则本意是忽略仓库根目录的运行日志目录，实际却同时匹配了 `miniprogram/pages/logs/`。

由于该目录从创建起就被忽略，其四个源文件（`index.js` / `index.json` / `index.wxml` / `index.wxss`）从未进入版本库，而 `git status` 也从不提示 —— 问题因此长期静默。

### 发现路径

实施 D2 删除 `miniprogram/pages/logs/index.js:466` 的调试日志后，`git status` 未显示该文件变更，`git diff --stat` 也只有 6 个文件而非预期的 7 个。追查 `git check-ignore -v` 得到：

```
.gitignore:46:logs	miniprogram/pages/logs/index.js
```

### 方案

```gitignore
# 仅忽略仓库根目录的运行日志目录；不带前导斜杠会误伤 miniprogram/pages/logs/ 等业务代码目录
/logs
*.log
npm-debug.log*
```

前导斜杠把匹配锚定到仓库根目录。随后将 `miniprogram/pages/logs/` 纳入版本控制。

### 边界确认

- `*.log` 与 `npm-debug.log*` 规则不变，所有日志**文件**仍被忽略。
- 根目录运行日志目录仍被 `/logs` 忽略（已验证 `git check-ignore -v logs` 命中 `.gitignore:47:/logs`）。
- 全仓库扫描确认被忽略的业务源码仅此一处：`miniprogram/env.js` 属有意忽略（含真实云环境 ID），其余无误伤。
- 核对 `app.json` 的 29 个注册页面，仅 `pages/logs/index` 在版本库中缺失，修复后归零。

### 为何纳入本次任务

该问题与原定的 C1/C2/C5 无关，属实施中偶然暴露。纳入的理由：

1. **严重度高于原计划的三项** —— 它意味着版本库不完整，换机器或重新 clone 即缺页面。
2. **修复成本极低且无副作用** —— 一行规则加一次 `git add`。
3. **发现窗口稀有** —— 若非恰好编辑了该目录内的文件并核对 `git status`，问题会继续潜伏。

## Rollout / rollback

三项修改互相独立，无共享状态，可单独回退：

- D1 涉及 1 个云函数文件 + 1 个测试文件。回退需同时还原两者（测试与实现耦合）。部署时需重新上传 `adminUpdateUserStatus`。
- D2 / D3 纯小程序端，无云函数变更，回退即还原对应行。

无数据库结构变更，无数据迁移，无需在云开发控制台做任何操作。

D1 的行为变化对用户可见：超管降级自己时由「成功」变为「拒绝并提示」。这是本次的预期修复目标，需在发布说明中提及。
