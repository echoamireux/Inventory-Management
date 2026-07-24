# 测试料主数据与型号库体验优化 Implementation Plan

## Phase 0. Preconditions

- [ ] 用户确认本规划摘要，允许进入实施阶段。
- [ ] 任务状态切到 `in_progress` 后，先加载 `trellis-before-dev`。
- [ ] 开始改代码前确认 `git status --short`，只处理本任务相关文件。

## Phase 1. 主数据页面字段收敛

- [ ] 修改 `miniprogram/pages/admin/material-edit.wxml`：
  - 正式物料显示“供应商信息”。
  - 测试料隐藏供应商/原厂型号输入，展示测试料型号库说明。
- [ ] 修改 `miniprogram/pages/admin/material-edit.js`：
  - 切换为测试料时清空 `form.supplier` 和 `form.supplier_model`。
  - 提交测试料时兜底清空 supplier/supplier_model。
- [ ] 修改 `cloudfunctions/manageMaterial/index.js`：
  - `buildGovernedMaterialMasterFields()` 对测试料清空 supplier/supplier_model。
  - 批量创建比较签名和数据构造与新规则一致。
- [ ] 同步物料导入模板/说明文案，避免测试料主数据模板继续暗示真实型号写在主数据。

## Phase 2. 测试料型号库页面体验

- [ ] 修改 `miniprogram/pages/admin/material-list.js`：
  - 外层“新增”直接进入独立测试料型号新增页。
- [ ] 修改 `miniprogram/pages/admin/test-material-identity-manage/index.js`：
  - 移除 `action=create` 自动弹窗。
  - 列表页“新增”按钮改为跳转独立新增页。
- [ ] 修改 `index.wxml/wxss`：
  - 列表卡片展示供应商。
  - 空状态/引导文案统一“新增/导入”的页面语言。
- [ ] 新增 `miniprogram/pages/admin/test-material-identity-edit/index.*`：
  - 普通页面表单，体验对齐 `material-edit`。
  - 加载已启用测试料主数据，使用下拉选择测试料产品代码。
  - 选中后自动展示所属物料名称和类别。
  - 表单包含原厂型号必填、供应商选填。
  - 提交 payload 增加 supplier。
- [ ] 更新 `miniprogram/app.json` 注册新增页。

## Phase 3. 测试料型号后端和共享合同

- [ ] 修改 `cloudfunctions/_shared/test-material-identities.js` 和所有同步副本：
  - 增加 supplier 规范化。
  - `normalizeTestMaterialIdentityRecord()` 保留 supplier。
  - identity selection validation 返回 supplier。
- [ ] 修改 `cloudfunctions/manageTestMaterialIdentity/index.js`：
  - create/batchCreate 保存 supplier。
  - list 查询 supplier，ranking auxiliaryFields 包含 supplier。
  - 审计记录包含 supplier。
- [ ] 如修改共享副本，运行 `npm run sync:shared`。

## Phase 4. 导入/导出模板协议

- [ ] 修改 `cloudfunctions/exportTestMaterialIdentityTemplate/identity-template-workbook.js`：
  - 表头增加 `供应商（选填）`。
  - 内联提示、帮助页、示例行、列宽、样式、导出测试同步。
- [ ] 修改 `miniprogram/pages/admin/test-material-identity-import/index.js/wxml`：
  - 三列表头校验。
  - 解析 supplier。
  - 预览展示 supplier。
  - 导入 payload 传 supplier。
  - “导出模板后填写 B/C 列”的提示文案同步。

## Phase 5. 选择器默认供应商联动

- [ ] 修改 `miniprogram/utils/test-material-identity-service.js`：
  - `buildTestMaterialIdentityActions()` 携带 supplier，并在 action 文案中展示供应商（若有）。
- [ ] 修改入库、批量入库、标签预打印页面：
  - 选择测试料型号后，如果当前供应商为空，则带入 identity.supplier。
  - 已有用户填写供应商时不覆盖。
- [ ] 修改云函数入库/预打印路径：
  - identity validation 返回 supplier。
  - 测试料库存/预打印快照在请求供应商为空时使用 identity.supplier。
  - 补打使用库存/预生成标签快照，不回查 identity supplier。

## Phase 6. Tests

- [ ] 更新 `tests/material-master-specs.test.js`：
  - 测试料主数据不再显示供应商/原厂型号输入。
  - 测试料提交清空 supplier/supplier_model。
- [ ] 更新 `tests/test-material-identities.test.js`：
  - 外层新增直接进入独立新增页。
  - 列表页新增也进入同一新增页。
  - 新增页用下拉选择测试料产品代码并包含供应商选填。
  - 没有已启用测试料主数据时提示先维护代码壳。
  - 模板三列表头和帮助页。
  - 模板 A 列继续使用已启用测试料产品代码下拉。
  - create/batchCreate 保存 supplier。
  - supplier 不参与 identity_key / duplicate key。
  - 搜索 supplier 命中辅助字段。
- [ ] 更新入库/标签相关测试：
  - 选择 identity supplier 可默认带入。
  - 用户显式填写 supplier 时不被覆盖。
- [ ] 不增加旧两列模板或历史旧记录兼容测试；当前数据库为空，按新三列表头和新字段规则验证。

## Validation Commands

- [ ] `node --check miniprogram/pages/admin/material-edit.js`
- [ ] `node --check miniprogram/pages/admin/test-material-identity-manage/index.js`
- [ ] `node --check miniprogram/pages/admin/test-material-identity-edit/index.js`
- [ ] `node --check miniprogram/pages/admin/test-material-identity-import/index.js`
- [ ] `node --check cloudfunctions/manageMaterial/index.js`
- [ ] `node --check cloudfunctions/manageTestMaterialIdentity/index.js`
- [ ] `node --test tests/material-master-specs.test.js tests/test-material-identities.test.js tests/stock-form.test.js tests/preprint-label-stock-in.test.js`
- [ ] `git diff --check`
- [ ] `npm test`
- [ ] `npm run preflight:deploy`

## Deployment Notes

- 不新增集合。
- 需要重新部署受影响云函数，预计包括：
  - `manageMaterial`
  - `manageTestMaterialIdentity`
  - `exportTestMaterialIdentityTemplate`
  - 如同步 identity supplier 到库存/标签默认值，还包括 `addMaterial`、`batchAddInventory`、`importInventoryTemplate`、`exportLabelData`，以及共享副本校验涉及的函数。
- 需要上传小程序前端代码。

## Rollback Points

- 若 supplier 默认带入影响现场使用，可先回退选择器自动带入，保留 identity.supplier 字段和模板列。
- 若模板三列导入失败，可要求现场重新导出最新版模板；无需数据库迁移。
- 若主数据隐藏字段引发正式料回归，回退 `material-edit` 条件渲染与测试料提交清空逻辑。

## Execution Notes

- 2026-07-24：已实现主数据测试料字段收敛、测试料型号独立新增页、三列模板协议、identity supplier 保存/搜索/展示，以及入库、批量入库、库存模板导入和标签预打印的 supplier 默认带入。
- 2026-07-24：根据现场 UI 反馈继续优化：测试料型号新增页正文不再重复导航标题，空状态操作居中；物料主数据表单将“测试料”开关前置到物料名称上方，并在启用后默认填入“测试料”和当前类别内置“测试料”子类别。
- 2026-07-24：相似型号检查增加“忽略全部空格”的相似键，`A C` 与 `AC` 触发相似确认但不作为强重复；测试料型号导出模板放大 A/B/C 列宽并提高第 2 行提示高度。
- 已运行 `npm run sync:shared` 同步共享 helper 副本。
- 已运行 `node --test tests/material-master-specs.test.js tests/test-material-identities.test.js tests/material-template.test.js tests/material-import.test.js tests/inventory-template-page.test.js tests/batch-add.test.js tests/inventory-template-import.test.js tests/stock-form.test.js tests/preprint-label-stock-in.test.js tests/label-export.test.js tests/batch-entry-page.test.js`，通过 `161/161`。
- 已运行 `npm test`，通过 `549/549`。
- 已运行 `git diff --check`，通过。
- 已运行 `npm run preflight:deploy`，通过。
