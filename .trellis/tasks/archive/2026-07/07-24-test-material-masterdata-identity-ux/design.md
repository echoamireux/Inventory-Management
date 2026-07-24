# 测试料主数据与型号库体验优化 Design

## Architecture and Boundaries

本任务不改变库存核心模型，只收敛测试料主数据和测试料型号库的职责边界：

```text
测试料主数据 materials
  └─ 代码壳：product_code、category、sub_category、default_unit、规格、is_test_material

测试料型号库 test_material_identities
  └─ 真实型号：product_code、supplier_model、supplier_model_key、supplier(选填)、status

库存/标签快照 inventory / preprint labels
  └─ 业务发生时的 supplier、supplier_model、supplier_model_key 快照
```

`supplier` 加入 `test_material_identities` 后只是来源/默认供应商，不参与唯一身份键。唯一性继续由 `category + product_code + supplier_model_key` 保证，避免“同型号不同供应商”拆成多个库存身份，导致出入库和报表统计变复杂。

## Data Flow

### 手工新增测试料型号

```text
test-material-identity-edit 新增页
  -> 加载已启用测试料主数据列表
  -> 用户从下拉中选择测试料产品代码，如 J-999
  -> 自动带出物料名称、类别
  -> 用户填写 supplier_model + supplier(选填)
  -> test-material-identity-service.createTestMaterialIdentity()
  -> manageTestMaterialIdentity.create
  -> normalizeTestMaterialIdentityRecord()
  -> test_material_identities.add()
  -> audit_events.writeAuditEvent()
  -> 列表刷新展示 supplier
```

前端负责基础必填校验和输入规范化；后端负责主数据有效性、测试料标记、重复型号、相似型号确认、审计和最终写入。

### 批量导入测试料型号

```text
exportTestMaterialIdentityTemplate
  -> 三列表头模板：测试料产品代码* / 原厂型号* / 供应商（选填）
  -> test-material-identity-import 解析预览
  -> rows: [{ rowIndex, product_code, supplier_model, supplier }]
  -> manageTestMaterialIdentity.batchCreate
  -> 逐行 createIdentity
```

供应商缺省时保存为空。重复判断不包含供应商：同一测试料产品代码下相同原厂型号只有一条身份记录。

### 入库、批量入库和标签预打印

`buildTestMaterialIdentityActions()` 返回 action 时新增 `supplier` 字段。选择某个型号后：

- `supplier_model` 和 `supplier_model_key` 仍按现有强规则写入。
- `supplier` 作为默认值带入：如果当前表单/导入行已经有供应商，则保留用户输入；否则使用型号库 supplier。
- 云函数侧 `validateTestMaterialIdentitySelection()` / `loadTestMaterialIdentityForSelection()` 返回匹配 identity 的 `supplier`，库存入库或预打印构造快照时也可用作缺省值。

补打标签使用库存/预生成标签当时保存的快照，不用型号库后续字段反向改写业务记录。

## UI Design

### 物料主数据新增/编辑页

- 正式物料：保留“供应商信息”分组。
- 测试料：隐藏供应商/原厂型号输入，显示说明卡片：
  - “测试料主数据只维护统一代码壳。”
  - “真实原厂型号和可选供应商请在测试料型号库维护。”
  - “入库、批量导入和标签预打印只能选择已启用型号。”
- 切换到测试料时，前端清空 `form.supplier` 和 `form.supplier_model`；提交时再次兜底清空。

### 测试料型号库列表页

- 列表页不承载新增表单弹窗；它只承载浏览、搜索、状态切换，以及跳转新增/导入。
- 页面顶部保留单一“新增”按钮，点击后进入独立新增页。
- 空状态可提示：“请先点击新增或导入模板维护测试料型号。”
- 卡片展示顺序：原厂型号、产品代码/类别/状态、所属物料、供应商（若有）、匹配原因。

### 新增页

- 字段：
  1. 测试料产品代码（下拉选择，必填，如 `J-999`）
  2. 原厂型号（必填）
  3. 供应商（选填）
- 外部主数据管理页点击“新增”和测试料型号库列表页点击“新增”都进入同一个新增页。
- 新增页采用普通页面表单，不用底部弹窗；这和物料主数据“新增物料”体验一致，也避免用户重复点击。
- 产品代码下拉选项只加载物料主数据中 `status === active` 且 `is_test_material === true` 的记录；每个选项展示 `product_code + material_name + 类别`。
- 选中后显示所属物料名称和类别，提交时后端仍重新校验主数据存在、启用且为测试料。
- 不提供类别/代码前缀选择器，因为测试料型号必须挂在已建档测试料代码壳下；下拉选择可避免手输错码。

## Backend Contracts

### `test_material_identities` 记录

新增/规范化字段：

```js
{
  supplier: '', // optional, normalized trimmed text
  // existing:
  category,
  material_id,
  product_code,
  material_name,
  supplier_model,
  supplier_model_key,
  identity_key,
  status
}
```

`identity_key` 不变：

```text
<category>::<product_code>::<supplier_model_key>
```

### `manageTestMaterialIdentity`

- `list`：关键词查询 OR 条件加入 `supplier`；排序仍使用现有 ranked search。
- `create`：接收 `supplier`，规范化并保存；审计 `after/detail` 包含 supplier。
- `batchCreate`：行级结果可附加 supplier，但重复/相似型号规则不因 supplier 改变。
- `setStatus`：不变。

### `manageMaterial`

- 测试料主数据写入时忽略/清空 `supplier` 和 `supplier_model`。
- 正式料仍保留现有字段。
- 批量创建主数据时，测试料行即使填写供应商/原厂型号，也不会写入测试料主数据；导入帮助文案解释这两列主要用于正式物料，测试料真实型号去型号库维护。

## Compatibility and Migration

- 不需要新增集合。
- 当前数据库为空，不做历史数据迁移、旧两列模板兼容或旧型号记录清洗。
- `test_material_identities.supplier` 是可选字段；新模板和新接口允许留空。
- 模板直接升级为三列；A 列继续使用系统当前已启用测试料主数据生成 Excel 下拉。前端导入按最新版三列表头校验，提示用户重新导出最新模板。

## Trade-offs

- 不把 supplier 放进唯一键：减少库存身份碎片，是本任务推荐方案；代价是同一产品代码 + 原厂型号只能有一个默认供应商。
- 使用测试料产品代码下拉：减少手输错误，是推荐方案；代价是管理员必须先建好测试料主数据代码壳，且新增页需要先加载可选测试料主数据。
- 不做完整身份编辑/合并：控制范围；本次新增独立表单页优先用于新增，已有型号仍只支持启用/停用。

## Rollout and Rollback

- 当前数据库为空，不需要迁移回滚；如模板导入失败，提示用户重新导出最新版模板。
- 如果供应商默认带入影响现场填写习惯，可回退前端自动带入逻辑，保留 identity 的 supplier 元数据。
