# 统一物料管理与测试料有效名称 - Implementation Plan

## Ordered Checklist

### 1. Prepare shared contracts

- [x] 检查现有测试料身份 helper，确定能否抽取 effective value 逻辑。
- [x] 扩展测试料身份 normalizer：
  - `label_material_name`
  - `subcategory_key`
  - `sub_category`
  - 继续保留 `supplier_model_key` 唯一身份。
- [x] 如修改 `_shared` helper，运行 `npm run sync:shared`。

### 2. Backend: test material identity

- [x] 修改 `cloudfunctions/manageTestMaterialIdentity/index.js`：
  - create / update 接收并校验有效名称和系统子类别；
  - list/search 返回有效名称、子类别、所属代码壳信息；
  - 审计包含新增字段。
- [x] 修改/同步测试料身份相关云函数 helper 副本。
- [x] 增加测试：
  - 有效名称必填；
  - 子类别 key/name 校验；
  - 供应商不参与唯一身份；
  - 相似型号规则不回退。

### 3. Backend: material import mixed routing

- [x] 修改 `miniprogram/utils/material-import.js` 的预览/校验，使 `是否测试料=是` 时：
  - 物料名称变成测试料有效名称；
  - 子类别按系统子类别校验；
  - 原厂型号必填；
  - 供应商选填。
- [x] 修改 `cloudfunctions/manageMaterial/index.js` 的 `batchCreate`：
  - formal rows 使用现有正式料逻辑；
  - test rows 确保/创建测试料代码壳；
  - test rows 创建/更新测试料身份；
  - 返回导入统计区分 formal/test created/skipped/errors。
- [x] 保持物料导入模板表头不变。
- [x] 增加混合导入测试：
  - 正式料 + 测试料同文件导入；
  - 测试料重复产品代码 + 原厂型号；
  - 相似型号提示；
  - 超过 100 行仍阻断。

### 4. Backend: effective snapshots

- [x] 修改测试料身份选择 helper，使其返回：
  - `label_material_name`
  - `subcategory_key`
  - `sub_category`
  - `supplier`
  - `supplier_model`
  - `supplier_model_key`
- [x] 修改以下入口写快照：
  - `cloudfunctions/addMaterial/index.js`
  - `cloudfunctions/batchAddInventory/index.js`
  - `cloudfunctions/batchAddInventory/batch-add.js`
  - `cloudfunctions/importInventoryTemplate/index.js`
  - `cloudfunctions/importInventoryTemplate/inventory-import.js`
  - `cloudfunctions/exportLabelData/index.js`
- [x] 保证补打标签、库存导出、报表导出优先使用快照。

### 5. Frontend: unified material management

- [x] 修改 `miniprogram/pages/admin/material-list.*`：
  - 正式料和测试料型号统一展示；
  - 测试料显示有效名称/子类别；
  - 操作入口统一。
- [x] 修改 `miniprogram/pages/admin/test-material-identity-edit/index.*`：
  - 新增页去掉重复标题/中间新增动作；
  - 产品代码下拉；
  - 物料名称，辅助文案说明用于标签、入库和库存展示；
  - 系统子类别下拉；
  - 管理子类别权限入口。
- [x] 保留原测试料型号维护路由作为回退/兼容入口。

### 6. Templates / docs

- [x] 物料主数据模板表头保持不变，只调整说明文案/示例行。
- [x] 删除测试料型号独立模板、页面、导出云函数和 `batchCreate` 接口；批量维护统一走物料主数据导入。
- [x] README 补充：
  - 正式料 / 测试料维护口径；
  - `是否测试料=是` 的导入分流；
  - 部署影响和需要部署的云函数。

### 7. Validation

- [x] `npm test`
- [x] `git diff --check`
- [x] `npm run preflight:deploy`
- [ ] 手工 smoke test：
  - 统一物料管理搜索正式料和测试料；
  - 新增测试料型号；
  - 物料主数据混合导入；
  - 测试料标签预生成；
  - 测试料单条入库；
  - 测试料批量入库；
  - 库存模板导入；
  - 补打标签和库存导出。

## Rollback Points

- 如果统一列表复杂度过高，可先保留列表分组，但仍完成有效名称/快照规则。
- 如果混合导入风险过高，可临时禁用物料主数据模板里的测试料行分流，但不恢复独立测试料型号导入入口；必须给出明确提示，不能静默按普通材料导入。
- 如果共享 helper 改动造成副本同步风险，先完成云函数本地直接修复并用 `preflight:deploy` 阻断漂移后再提交。
