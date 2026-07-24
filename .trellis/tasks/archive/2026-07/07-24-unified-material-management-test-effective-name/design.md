# 统一物料管理与测试料有效名称 - Design

## Architecture

本任务采用“体验合并、模型分层”的设计：

```text
统一物料管理 UI
├── 正式物料视图/编辑/统一导入 → materials
└── 测试料型号视图/编辑/统一导入分流 → test_material_identities + materials 测试料代码壳
```

底层不把测试料型号写成多条普通 `materials`，因为正式料和测试料的唯一性不同：

- 正式料唯一：`product_code`
- 测试料唯一：`category + product_code + supplier_model_key`

## Data Contracts

### materials

正式料记录保持现有语义。

测试料 `materials` 记录继续作为代码壳：

```js
{
  product_code: 'J-999',
  category: 'chemical' | 'film',
  is_test_material: true,
  material_name: '测试料',
  subcategory_key: '<built-in-test-material-subcategory-key>',
  sub_category: '测试料',
  supplier: '',
  supplier_model: '',
  status: 'active'
}
```

### test_material_identities

新增/扩展字段：

```js
{
  product_code: 'J-999',
  category: 'chemical' | 'film',
  material_id: '<test material shell id>',
  label_material_name: '环氧树脂样品',
  subcategory_key: '<system subcategory key>',
  sub_category: '树脂',
  supplier_model: 'ABC',
  supplier_model_key: 'ABC',
  supplier: '供应商A',
  identity_key: 'chemical::J-999::ABC',
  status: 'active' | 'disabled'
}
```

兼容展示时：

- 若旧记录没有 `label_material_name`，可 fallback 到 `material_name` 或所属代码壳名称，但新写入必须保存 `label_material_name`。
- 若旧记录没有 `subcategory_key`，可 fallback 到 `sub_category`，但新写入必须保存系统子类别 key。

## Effective Value Rules

### Effective material name

```text
正式料：materials.material_name
测试料：test_material_identities.label_material_name
```

User-facing UI copy should call this field simply `物料名称`. Avoid displaying long product-design terms such as `有效物料名称` or `现场标签名称`; use helper text like `用于标签、入库和库存展示` when the distinction needs to be explained.

### Effective subcategory

```text
正式料：materials.subcategory_key / materials.sub_category
测试料：test_material_identities.subcategory_key / test_material_identities.sub_category
```

### Snapshot write boundary

以下动作必须在业务记录中保存快照值：

- 单条入库；
- 批量入库；
- 库存模板导入；
- 标签预生成。

快照字段：

```js
{
  material_name,
  subcategory_key,
  sub_category,
  supplier_model,
  supplier_model_key,
  supplier,
  is_test_material
}
```

历史库存、补打标签、日志、报表、导出优先读取快照，不重新回读测试料身份库覆盖历史值。

## Import Design

### Material import template

现有物料主数据模板表头保持不变。

行分流：

- `是否测试料 = 否`
  - 路由到正式料导入逻辑；
  - 写 `materials`；
  - 唯一性按 `product_code`。
- `是否测试料 = 是`
  - 在物料主数据导入中路由到测试料型号写入逻辑；
  - 确保存在对应测试料代码壳；
  - 写 `test_material_identities`；
  - 唯一性按 `category + product_code + supplier_model_key`；
  - 模板里的“物料名称”映射为 `label_material_name`；
  - 模板里的“子类别”映射为测试料身份子类别；
  - 模板里的“供应商”映射为身份供应商；
  - 模板里的“原厂型号”必填，映射为 `supplier_model`。

### Row count / batching

物料主数据导入仍最多 100 行。该限制与库存入库模板导入不同。

库存入库模板导入和批量入库继续保持：

```text
最多 100 行 → 前端 10 行一批 → 批次 operation id → 失败批次可重试
```

本任务不改变这套库存入库协议。

## UI Design

### Unified material management page

页面主入口保持“物料管理 / 主数据管理”语义，但列表里同时出现：

- 正式物料；
- 测试料型号。

测试料代码壳不作为主列表中的主要业务物料展示，避免用户看到大量都叫“测试料”的记录。

推荐操作入口：

- 新增正式料；
- 新增测试料；
- 导入（统一使用物料主数据导入，正式料和测试料通过 `是否测试料` 分流）；
- 导出模板。

### Test material identity edit

新增测试料直接进入编辑页。

字段：

- 产品代码：下拉选择已有测试料代码；
- 物料名称：必填；
- 子类别：系统子类别下拉；
- 原厂型号：必填；
- 供应商：选填。

当无可选测试料代码：

- 管理员/超级管理员显示维护测试料代码入口；
- 普通用户显示“请联系管理员维护测试料代码”的空状态。

子类别旁边的管理入口遵守现有权限。

## Cloud Function Boundaries

### manageMaterial

- 继续负责正式料 CRUD。
- `batchCreate` 增加行分流：
  - formal rows → existing material logic；
  - test rows → test identity logic。
- 可复用/抽取测试料身份创建 helper，避免和 `manageTestMaterialIdentity` 复制分叉。

### manageTestMaterialIdentity

- 扩展创建/更新字段：
  - `label_material_name`
  - `subcategory_key`
  - `sub_category`
- 搜索和列表返回 effective display fields。
- 继续保留列表/编辑能力作为手工维护入口。
- 不再提供 `batchCreate`；测试料批量维护统一走 `manageMaterial.batchCreate`。

### addMaterial / batchAddInventory / importInventoryTemplate / exportLabelData

- 加载测试料身份时返回有效名称和子类别。
- 写入库存或预打印标签时保存快照。
- 正式料逻辑不允许被请求里的测试料字段覆盖。

## Compatibility

- 数据库当前近似空库；无需复杂历史迁移。
- 仍保持旧字段 fallback，降低页面或测试数据里旧对象为空导致的风险。
- 不改变集合数量。
- 不改变 Excel 表头，降低本地打印模板和用户习惯风险。

## Risks

- 风险：`manageMaterial.batchCreate` 同时写 `materials` 和 `test_material_identities`，结果统计可能变复杂。
  - 控制：按行返回类型、状态和消息，测试覆盖混合导入。
- 风险：测试料有效名称写快照漏掉某个入口，导致某些页面仍显示“测试料”。
  - 控制：覆盖单条入库、批量入库、模板导入、标签预生成和导出测试。
- 风险：共享 helper 副本漂移。
  - 控制：改 `_shared` 后运行 `npm run sync:shared`，并执行 `npm run preflight:deploy`。
