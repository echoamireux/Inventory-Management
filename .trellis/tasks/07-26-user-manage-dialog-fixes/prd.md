# 人员权限页弹窗交互与样式修复

## Goal

修复上线前走查发现的三个界面缺陷：action-sheet 取消按钮无响应、Dialog 确认按钮不居中、危险操作的红色确认按钮被全局样式强制成蓝色。

用户价值：

- 「人员与权限管理」页的操作面板可以正常通过取消按钮关闭。
- 确认弹窗的两个按钮左右等分对称，不再视觉失衡。
- 禁用账号、删除物料等危险操作的确认按钮恢复红色警示。

## Confirmed Facts

### 缺陷一：action-sheet 取消按钮无响应

`miniprogram/pages/super-admin/user-manage/index.wxml:84-92` 设置了 `cancel-text="取消"` 渲染出取消按钮，但只绑定了 `bind:select` 与 `bind:close`，**缺少 `bind:cancel`**。

vant action-sheet 是受控组件，`show` 完全由外部控制，三类交互触发不同事件：

| 交互 | 事件 | 原处理器 |
|---|---|---|
| 点遮罩 / 关闭图标 | `close` | `onUserActionsClose` |
| 点操作项 | `select` | `onUserActionSelect` |
| **点取消按钮** | **`cancel`** | **无** |

证据：`miniprogram_npm/@vant/weapp/action-sheet/index.js:68` 为 `this.$emit('cancel')`，组件自身不修改 `show`。

**影响面**：全项目 14 处 `van-action-sheet`，仅此一处存在该问题 —— 其余 13 处均未设置 `cancel-text`，不渲染取消按钮。

### 缺陷二：Dialog 按钮不居中

`miniprogram/app.wxss:636-667` 一段注释为「全局修复 Vant Dialog 按钮样式 / 强制按钮区域居中」的覆盖样式本身即问题源。

vant 原生布局本就正确完整：

```css
.van-dialog__footer { display: flex }      /* 容器 */
.van-dialog__button { flex: 1 }            /* 两按钮等分 */
.van-button { justify-content: center }    /* 按钮内文字居中 */
```

全局段以 `!important` 重新定义 `.van-dialog__button` 的 `display`/`align-items`/`justify-content`/`min-height`/`line-height`，却**未保留 `flex: 1`**，破坏等分布局。

两个关键前提：

- `miniprogram_npm/@vant/weapp/common/component.js:45` 设 `addGlobalClass: true`，所有 vant 组件允许全局样式穿透，故 app.wxss 确实作用到 dialog 内部节点。
- `van-dialog__button` 是通过 **`class`**（非 `custom-class`）设在 `<van-button>` 组件节点上的（`dialog/index.wxml:83`、`:98`），该选择器确实命中。

该段四条规则中另有三条问题：

| 规则 | 问题 |
|---|---|
| `.van-dialog__footer--buttons` | vant 模板中不存在该类名，死规则 |
| `.van-dialog__button .van-button__text` | 跨组件边界的后代选择器，小程序样式隔离下不生效 |
| `.van-dialog__confirm { color: #1989FA !important }` | 覆盖业务代码的 `confirmButtonColor`，见缺陷三 |

**结论：该段无一条规则提供正向价值，整段移除是安全的。**

### 缺陷三：危险操作红色确认按钮被强制成蓝色

`.van-dialog__confirm { color: #1989FA !important }` 的 `!important` 压过 van-button 的内联 `style="color: ..."`（`confirmButtonColor` 的落点）。

受影响四处：

| 位置 | 业务颜色 | 语义 |
|---|---|---|
| `super-admin/user-manage/index.js:156` | `#dc2626` 红 | 禁用账号 |
| `admin/material-list.js:546` | `#ee0a24` 红 | 删除/归档物料 |
| `admin/material-list.js:702` | `#ee0a24` 红 | 删除/归档物料 |
| `admin/user-list.js:125` | `#2C68FF` 蓝 | 品牌色 |

前三处均为危险操作，红色警示被抹掉。

### 相关背景

- 同批走查已确认：超管修改自己角色会被正确拒绝，任务 `07-26-pre-release-quality-fixes` 的 R1 防护生效。
- 全项目 Dialog 用法：`Dialog.confirm` 14 处、`Dialog.alert` 20 处、内联 `van-dialog` 12 个，**无任何一处使用 `theme="round-button"`**，即只存在一种按钮布局分支。这是「按形态验证即可全覆盖」的依据。

## Requirements

### R1. action-sheet 取消按钮必须能关闭面板

- `user-manage/index.wxml` 的 `van-action-sheet` 补 `bind:cancel`，复用既有的 `onUserActionsClose`（其实现即 `setData({ showUserActions: false })`，语义匹配）。
- 不新增 JS 方法。
- 遮罩关闭、关闭图标、操作项选择三条既有路径行为不变。

### R2. Dialog 按钮恢复等分居中

- 整段移除 `app.wxss` 中的全局 Dialog 覆盖样式，恢复 vant 原生布局。
- 不得改用「补 `flex: 1`」的方式保留该段 —— 其余三条规则同样有害或无效。
- 不修改任何业务 JS 的 Dialog 调用。

### R3. 危险操作确认按钮恢复业务设定颜色

- 随 R2 一并解决，`confirmButtonColor` 恢复生效。
- 不修改上述四处业务代码的颜色取值。

## Acceptance Criteria

- [x] 点「管理」→ 点底部「取消」，操作面板正常关闭。**已实机验证通过。**
- [x] 「设为管理员」确认弹窗中，「取消」与「确认执行」左右等分且各自居中。**已实机验证通过。**
- [x] 「禁用账号」确认弹窗的确认按钮显示为红色。**已实机验证通过 —— 该项同时是「样式改动是否真正编译生效」的判据**：`#1989FA` 与业务设定的 `#2563eb` 同为蓝色、肉眼难辨，而 `#dc2626` 红色一目了然。
- [x] `Dialog.alert` 单按钮弹窗布局正常。
- [x] `npm test` 全部通过（567/567）。
- [x] `npm run preflight:deploy` 通过。
- [x] 仅改动 `user-manage/index.wxml`、`app.wxss` 与对应测试，无云函数改动。

## 实施记录

分两次提交，第二次修正了第一次的做法：

| 提交 | 内容 |
|---|---|
| `fc654d6` | 补 `bind:cancel`；移除 app.wxss 中破坏布局的整段覆盖，依赖 vant 原生 `footer:flex` + `button:flex-1` |
| `bf8e6d4` | 实机验证发现仅移除覆盖后按钮仍偏移，改为在 app.wxss **显式声明**等分 |

第二次调整的依据：用浏览器复现 vant 真实 DOM 结构与样式做对照，原生规则在标准 flex 下结果正确（两按钮各 160/320、文字中心零偏移，加不加 `min-width:0` 相同）。故问题不在 CSS 逻辑，而在「依赖组件库内部实现」这一做法本身不够稳妥 —— 该布局在本项目已出现过两次失败的修复尝试。

最终 app.wxss 中只保留两条，与 vant 原生等价但不依赖其实现：

```css
.van-dialog__footer { display: flex !important; }
.van-dialog__button { flex: 1 1 0 !important; min-width: 0 !important; }
```

## 遗留观察（未处理）

`miniprogram/pages/admin/material-import/index.wxss:237-257` 的 `.fix-dialog-style` 段落（21 行）是同类的历史修复尝试，且为**纯死代码**：类名 `fix-dialog-style` 在全项目 wxml / js / json 中从未被任何元素引用，选择器所需的祖先类不存在，因此从未生效。该页面虽已配置 `styleIsolation: 'shared'`（`index.js:36-37`，即注释所述前提成立），但缺少承载类名的元素。

清理无风险，但属另一页面、不影响功能，故未在本任务内处理。留待后续迭代或单独确认。

## Notes

- 无云函数改动，**无需重新上传云函数**，仅需重新上传小程序代码包。
- 验证不需逐页面点击：三种弹窗形态在「人员与权限管理」一页内即可全部触发（双按钮蓝色确认 / 双按钮红色确认 / 单按钮 alert）。可选补充：物料管理页删除物料确认红色。
