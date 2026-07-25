# 实验室库存管理小程序

这是一个基于微信小程序云开发构建的实验室库存管理系统，面向化材与膜材的入库、库存查询、领用扣账、日志追溯、主数据管理与权限审批场景。

当前仓库以真实运行行为为准，核心目标不是做一个泛化 ERP，而是把实验室高频操作收口成一套可追溯、口径一致、适合一线使用的小程序工具。

## 当前业务定位

系统当前主要分为三条主链路：

1. 首页快捷入口
   顶部搜索用于进入库存查询结果；智能扫码用于精确标签操作；快捷领料用于直接发起领料动作。
2. 库存查询页
   承担正式库存浏览、风险筛选、产品聚合、批次聚合、标签层查看与详情核对。
3. 管理与审批链路
   管理员和超级管理员可执行用户审批、主数据维护、模板导出、导入、库区管理、子类别管理和角色治理。

系统当前同时保留两种领用模式：

- 便捷领用链路
  首页“快捷领料”支持 `按产品代码领料` 与 `按批次领料` 两种模式，适合实际用料扣账。
- 精确领用链路
  首页扫码与库存详情页面向具体标签编号，适合精确核对、精确扣减和追溯。

## 核心能力

### 1. FEFO 自动分配

库存扣减使用统一的分配顺序契约：

- 先按最早过期优先
- 同过期日按更早入库时间优先
- 仍相同则按 `unique_code` 与 `_id` 稳定兜底

也就是说，当前系统是 `FEFO` 优先，而不是旧版 README 中的 `FIFO` 单一口径。

### 2. 首页双入口职责清晰

- 首页顶部搜索
  只是库存入口，提交后跳转库存查询页，不在首页自己承载搜索结果。
- 首页“快捷领料”
  是动作入口，不承担正式浏览职责。
- 首页“智能扫码”
  用于入库、领料、查询三类标签级动作。

### 3. 库存三层浏览

库存查询页当前采用分层浏览模型：

1. 产品聚合层
2. 批次聚合层
3. 标签层
4. 标签详情页

其中：

- 单标签批次可直接进入详情
- 多标签批次在当前卡片下展开标签行
- 标签详情页继续承载精确库存、库位、临期信息、日志追溯与膜材幅宽修正

### 4. 风险预警与统计

首页当前统计口径包括：

- 总物料
- 预警
- 今日入库
- 今日出库

其中“预警”表示临期或低库存产品的并集，不再等价于单纯低库存。

全局低库存阈值维护在 `cloudfunctions/_shared/alert-config.js`：质量类化材按 `mass_g`、体积类化材按 `volume_ml`、膜材按基础长度 `length_m` 判断。当前值分别为 `50 g`、`50 mL`、`50 m`；`kg` 和 `L` 会在判断前自动换算，膜材展示为 `m²` 时仍按基础长度判断。

### 5. 主数据与导入模板治理

系统当前的正式导入模板来源，是管理员在系统内动态导出的最新 `.xlsx` 模板：

- 模板由 `exportMaterialTemplate` 云函数按当前子类别、单位和说明动态生成
- 产品代码在模板中拆分为“代码前缀”和“产品编号”：前缀只填写 `J`、`S`、`Y`、`M` 这类字母，系统导入后组合为完整 `J-001`、`S-001`、`Y-001`、`M-001` 作为唯一身份
- 管理员填写后保持为 `.xlsx` 再回到系统上传导入
- 系统导出的模板是唯一正式模板来源

仓库不再维护本地静态“智能版模板”文件，也不再依赖本地 Python 脚本生成模板。

### 6. 膜材数量真值与幅宽治理

膜材场景当前已经收口为统一显示口径：

- 聚合层、批次层、标签层、详情层共用统一显示真值逻辑
- 支持根据默认单位或展示单位进行换算
- 管理员可在标签详情中执行“修正幅宽”
- 主数据默认幅宽与批次、标签实际幅宽语义已区分

### 7. 搜索与日志追溯

系统当前已覆盖多页面搜索：

- 首页顶部搜索
- 库存查询
- 物料目录
- 主数据管理
- 操作日志
- 审计日志

日志链路拆分为两类：

- `inventory_log`
  库存数量流水，用于标签详情、项目用料报表、库存纠错申请和库存变动追溯。
- `audit_events`
  管理审计唯一查询源，用于追踪主数据、权限、项目编码、子类别、库区坐标、标签预打印与库存写入动作。

后台“审计日志”页面已拆成“库存流水”和“管理审计”两个页签。库存流水保留纠错申请入口；管理审计支持按领域、动作、操作人、关键字和日期检索。

## 角色与状态

### 用户状态

系统使用微信身份识别，不是账号密码体系。注册后通常会经历以下状态：

- `pending`
  待审批，不能进入正式首页
- `rejected`
  已驳回，可查看原因并修改后重提
- `active`
  已激活，可按角色使用系统

### 角色边界

- `user`
  已激活后可执行日常入库、领料、库存查询、操作日志查看、物料申请
- `admin`
  在普通用户基础上，可审批、维护主数据、导入、维护库区与子类别、查看审计日志
- `super_admin`
  在管理员基础上，可调整用户角色、禁用或恢复正式账号，并负责超级管理员交接

前端角色判断主要用于页面体验；敏感操作以后端权限校验为准。

## 当前页面结构

`miniprogram/app.json` 中当前主要页面包括：

- `pages/index/index`
  首页
- `pages/register/index`
  注册
- `pages/material-add/index`
  单条入库
- `pages/material-add/batch-entry`
  批量入库
- `pages/inventory/index`
  库存查询
- `pages/inventory/detail-list`
  批次层与中间列表页
- `pages/inventory/labels/index`
  标签层列表页
- `pages/inventory-detail/index`
  标签详情页
- `pages/material-directory/index`
  物料目录
- `pages/material-edit/index`
  物料编辑
- `pages/logs/index`
  操作日志
- `pages/admin-logs/index`
  审计日志
- `pages/my-requests/index`
  我的申请
- `pages/admin/approval-center/index`
  审批中心
- `pages/admin/material-import/index`
  物料导入
- `pages/admin/test-material-identity-edit/index`
  新增/编辑测试料型号
- `pages/admin/zone-manage/index`
  库区与详细坐标管理
- `pages/admin/subcategory-manage/index`
  子类别管理
- `pages/super-admin/user-manage/index`
  超级管理员用户管理

## 关键云函数

当前仓库中与核心业务直接相关的主要云函数包括：

- `userLogin` / `registerUser`
  登录与注册
- `getDashboardStats`
  首页统计与预警
- `getInventoryGrouped`
  产品聚合库存查询
- `getInventoryBatches`
  批次聚合查询
- `searchInventory`
  标签与库存检索
- `updateInventory`
  领用扣减
- `batchAddInventory`
  批量入库
- `addMaterial`
  单条物料入库
- `manageMaterial`
  主数据列表、编辑、归档、恢复等
- `editInventory` / `removeInventory`
  单标签库存纠错、删除约束与审计链路
- `addMaterialRequest` / `approveMaterialRequest`
  建档申请与审批
- `manageProductCodePrefix`
  产品代码前缀维护，例如化材 `J`、`S`、`Y` 与膜材 `M`
- `exportMaterialTemplate`
  动态导出最新导入模板
- `exportInventoryTemplate` / `importInventoryTemplate`
  动态导出库存入库模板与批量库存导入
- `exportData`
  导出报表
- `manageSubcategory`
  子类别管理
- `addWarehouseZone`
  库区与详细坐标管理
- `getLogs`
  日志查询
- `adminUpdateUserStatus`
  管理员审批用户状态；超级管理员调整角色、禁用或恢复正式账号

## 技术栈

- 前端
  微信小程序原生 `WXML / WXSS / JS`
- UI 组件
  `@vant/weapp`
- 后端
  微信云开发 Cloud Functions
- 数据库
  微信云数据库
- 模板导出
  云函数内使用工作簿生成逻辑动态构造 `.xlsx`
- 测试
  Node.js 原生测试运行器

## 目录结构

```text
├── cloudfunctions/
│   ├── _shared/                      # 共享工具、鉴权、模板与库存分配逻辑
│   ├── exportMaterialTemplate/       # 动态导出最新物料导入模板
│   ├── getDashboardStats/            # 首页统计与风险预警
│   ├── getInventoryGrouped/          # 产品聚合库存查询
│   ├── getInventoryBatches/          # 批次聚合查询
│   ├── updateInventory/              # 领用扣减与分摊日志
│   ├── manageMaterial/               # 主数据维护
│   ├── manageSubcategory/            # 子类别管理
│   ├── addWarehouseZone/             # 库区与详细坐标管理
│   ├── getLogs/                      # 日志查询
│   └── ...
├── miniprogram/
│   ├── pages/                        # 页面
│   ├── components/                   # 公共组件
│   ├── utils/                        # 前端共享工具
│   └── env.example.js                # 环境配置模板
├── tests/                            # Node 测试
├── package.json
└── README.md
```

## 快速开始

### 1. 环境准备

- 安装 [Node.js](https://nodejs.org/)
- 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### 2. 安装依赖

在仓库根目录执行：

```bash
npm install
```

### 3. 同步共享模块

本项目使用 `cloudfunctions/_shared` 维护共享逻辑。首次拉取代码或更新共享模块后，建议同步一次：

```bash
npm run sync:shared
```

该脚本会把共享模块同步到依赖这些共享文件的云函数目录，避免前后版本不一致。

### 4. 配置云环境

1. 在微信开发者工具中开通云开发并获取环境 ID
2. 在 `miniprogram` 目录下复制环境模板：

```bash
cd miniprogram
cp env.example.js env.js
```

3. 编辑 `miniprogram/env.js`：

```javascript
module.exports = {
  env: "YOUR-REAL-ENV-ID",
  traceUser: true,
};
```

`env.js` 已被忽略，不会提交到仓库。

### 5. 部署云函数

在微信开发者工具中，对需要使用的云函数执行“上传并部署：云端安装依赖”。

发布前先在本地执行：

```bash
npm run sync:shared
npm run preflight:deploy
npm test
npm run release:check
```

`npm run preflight:deploy` 是只读发布预检，会检查清单登记的全部可部署云函数目录、前端实际调用的云函数、共享文件副本内容哈希、依赖锁文件、README 必需集合/索引说明和关键查询稳定排序。预检失败时不要上传正式版。

正式上传前必须执行 `npm run release:check`。该命令会依次运行 `npm test` 和 `npm run preflight:deploy`，检查本机 `miniprogram/env.js` 不是占位环境 ID，并要求存在被 `.gitignore` 忽略的 `scripts/release-readiness.json`。发布人员在正式库确认集合、索引、ACL 和旧云函数清理后，从 `scripts/release-readiness.example.json` 创建该文件；没有确认文件时发布检查主动失败。

建议首次接手项目时至少重新部署以下函数：

- `userLogin`
- `registerUser`
- `getDashboardStats`
- `getInventoryGrouped`
- `getInventoryBatches`
- `getInventoryRecord`
- `updateInventory`
- `addMaterial`
- `batchAddInventory`
- `importInventoryTemplate`
- `manageMaterial`
- `manageTestMaterialIdentity`
- `editInventory`
- `removeInventory`
- `approveMaterialRequest`
- `manageProductCodePrefix`
- `exportMaterialTemplate`
- `exportInventoryTemplate`
- `exportLabelData`
- `exportData`
- `getProjectUsageReport`
- `exportProjectUsageReport`
- `manageProjectCode`
- `manageSubcategory`
- `addWarehouseZone`
- `getOperators`
- `getLogs`
- `getApprovalCenterData`
- `adminUpdateUserStatus`
- `approveInventoryCorrectionRequest`
- `submitInventoryCorrectionRequest`

旧的 `login`、`initMDMCollection` 和独立测试料模板导出函数 `exportTestMaterialIdentityTemplate` 已从仓库移除。部署前请在云开发控制台逐项确认：删除云端 `login`、删除云端 `initMDMCollection`、删除云端 `exportTestMaterialIdentityTemplate`，避免旧入口继续被误调用。

首次部署本版本前，先在云数据库创建 `operation_receipts`、`audit_events`、`preprint_jobs`、`preprint_daily_usage`、`test_material_identities` 集合。不要清空或重建 `preprinted_labels`、`system_counters`，历史标签编号必须永久保留且不得复用。

`removeInventory` 安全部署要求：仓库内该函数已停用数据库写入，只保留“删除入口已停用”的兼容响应。云端必须重新部署新版 `removeInventory`，并确认日常页面没有库存删除入口。库存减少只能通过领用或盘点纠错审批链路完成。

权限例外：管理员继续可以直接执行盘点调整，也允许审批自己提交的纠错申请，当前不实施四眼审批。上述库存变更仍必须写入库存流水和 `audit_events`；审计写入失败时，业务事务必须一并回滚。

测试料型号库说明：测试料在 `materials` 中仍只保存测试料产品代码壳，例如 `J-999`；真实现场显示信息保存在 `test_material_identities`。其中 `label_material_name` 是标签、入库、库存查询和导出里的“物料名称”，`sub_category` / `subcategory_key` 是测试料型号自己的子类别快照，`supplier` 为选填默认供应商，只用于入库和标签预打印时帮用户带出默认值；唯一身份仍由 `identity_key`（类别 + 测试料产品代码 + 规范原厂型号）决定，不因供应商不同拆分记录，也不需要新增集合或额外唯一索引。

物料主数据导入支持正式料和测试料同模板维护：`是否测试料=否` 时按正式物料处理，唯一性为产品代码；`是否测试料=是` 时必须使用已维护且启用的测试料代码壳，并按“产品代码 + 原厂型号”创建或跳过 `test_material_identities` 记录，模板中的“物料名称”和“子类别”会作为测试料标签/库存展示值。模板说明页会列出当前可用测试料代码；若误填未维护代码（例如把 J-999 写成 J-998），系统会拒绝导入而不会自动创建新测试料代码壳。系统不再提供独立的测试料型号导入页面、导入模板或模板导出云函数；批量维护统一走物料主数据导入。库存入库模板导入和扫码批量入库的最多 100 行、每 10 行一批、失败批次可重试协议不变。

标签导出、库存导出和报表表头保持现有列名；正式料的“物料名称”取 `materials.material_name`，测试料的“物料名称”取入库或预打印时保存的快照，快照来源为 `test_material_identities.label_material_name`。

### 6. 生产索引配置建议

云数据库索引需要在微信云开发控制台手动创建。正式投产前，建议至少配置以下索引：

| 集合 | 索引字段 | 类型 | 用途 |
| --- | --- | --- | --- |
| `users` | `users._openid` | 唯一索引，升序 | 防止重复注册，保证一个微信用户只对应一条人员记录 |
| `inventory` | `inventory.unique_code` | 唯一索引，升序 | 确保标签编号全库唯一，支持扫码查询 |
| `materials` | `materials.product_code` | 唯一索引，升序 | 确保标准物料代码全库唯一 |
| `product_code_prefixes` | `product_code_prefixes.prefix` | 唯一索引，升序 | 确保产品代码前缀不重复，例如 `J` 和 `S` 作为不同前缀维护 |
| `product_code_prefixes` | `product_code_prefixes.category + status + sort_order` | 复合索引，升序 + 升序 + 升序 | 支持前缀管理页和模板导出按类别加载启用前缀 |
| `test_material_identities` | `test_material_identities.identity_key` | 唯一索引，升序 | 确保同一测试料代码壳下的同一规范原厂型号不重复 |
| `test_material_identities` | `test_material_identities.product_code + status + supplier_model_key` | 复合索引，升序 + 升序 + 升序 | 支持测试料入库、预打印和领用按产品代码快速校验启用型号 |
| `test_material_identities` | `test_material_identities.material_id + status + updated_at desc` | 复合索引，升序 + 升序 + 降序 | 支持业务页按测试料主数据加载可选型号 |
| `preprinted_labels` | `preprinted_labels.unique_code` | 唯一索引，升序 | 确保预生成标签编号全库唯一，防止预打印重复发号 |
| `preprinted_labels` | `preprinted_labels.operator_id + create_time desc` | 复合索引，升序 + 降序 | 支持标签打印页按本人最近批次倒序加载 |
| `preprinted_labels` | `preprinted_labels.job_id + operator_id` | 复合索引，升序 + 升序 | 支持重新导出、恢复查看和作废指定预生成批次 |
| `preprinted_labels` | `preprinted_labels.job_id + operator_id + job_index` | 复合索引，升序 + 升序 + 升序 | 支持按任务稳定恢复完整标签顺序 |
| `preprint_jobs` | `preprint_jobs.operator_id + created_at desc` | 复合索引，升序 + 降序 | 支持本人最近预打印任务倒序加载 |
| `operation_receipts` | `operation_receipts.operator_id + created_at desc` | 复合索引，升序 + 降序 | 支持库存写入幂等凭证排查与后台清理 |
| `audit_events` | `audit_events.timestamp desc` | 普通索引，降序 | 支持管理审计按时间倒序加载 |
| `audit_events` | `audit_events.actor_id + timestamp desc` | 复合索引，升序 + 降序 | 支持按操作者追溯管理审计 |
| `audit_events` | `audit_events.domain + timestamp desc` | 复合索引，升序 + 降序 | 支持按审计领域筛选，例如库存、预打印、主数据和权限 |
| `preprint_daily_usage` | 稳定文档 ID，无额外查询索引 | 无 | 按操作者和北京时间日期累计预打印额度 |
| `users` | `users.status + create_time desc` | 复合索引，升序 + 降序 | 支持人员审批分页 |
| `material_requests` | `material_requests.status + created_at desc` | 复合索引，升序 + 降序 | 支持物料审批分页 |
| `inventory_correction_requests` | `inventory_correction_requests.status + created_at desc` | 复合索引，升序 + 降序 | 支持库存纠错审批分页 |
| `material_requests` | `material_requests.product_code + status` | 复合索引，升序 + 升序 | 支持事务内检查同一产品代码的待审批申请 |
| `inventory_correction_requests` | `inventory_correction_requests.source_log_id + status` | 复合索引，升序 + 升序 | 支持事务内检查同一入库日志的待审批纠错申请 |
| `material_requests` | `material_requests.pending_key` | 唯一索引 | 仅约束 pending 物料申请并发去重；审批或驳回后清理该字段，历史记录继续保留 |
| `inventory_correction_requests` | `inventory_correction_requests.pending_key` | 唯一索引 | 仅约束 pending 纠错申请并发去重；审批或驳回后清理该字段，历史记录继续保留 |
| `project_codes` | `project_codes.project_code` | 唯一索引，升序 | 确保项目编码唯一 |
| `material_subcategories` | `material_subcategories.subcategory_key` | 唯一索引，升序 | 确保子类别稳定 ID 唯一 |
| `warehouse_zones` | `warehouse_zones.zone_key` | 唯一索引，升序 | 确保库区稳定 ID 唯一 |
| `warehouse_location_details` | `warehouse_location_details.detail_key` | 唯一索引，升序 | 确保每个详细坐标稳定 ID 唯一，支持 F1-F5 改名后库存展示跟随最新名称 |
| `warehouse_location_details` | `warehouse_location_details.zone_key + sort_order` | 复合索引，升序 + 升序 | 支持库区管理页按库区加载和排序详细坐标 |
| `inventory` | `inventory.product_code + status` | 复合索引，升序 + 升序 | 支持按产品代码查询在库库存和领料候选 |
| `inventory` | `inventory.product_code + status + batch_number` | 复合索引，升序 + 升序 + 升序 | 支持按产品代码和批次查询库存 |
| `inventory` | `inventory.product_code + status + supplier_model` | 复合索引，升序 + 升序 + 升序 | 支持测试料共用 `999` 时按原厂型号拆分查询库存 |
| `inventory` | `inventory.product_code + status + supplier_model + batch_number` | 复合索引，升序 + 升序 + 升序 + 升序 | 支持测试料按产品代码、原厂型号和批号展开标签明细 |
| `inventory` | `inventory.product_code + status + expiry_date + create_time + _id` | 复合索引，升序 + 升序 + 升序 + 升序 + 升序 | 支持产品维度事务内按 FEFO 稳定增量读取领用候选 |
| `inventory` | `inventory.product_code + status + batch_number + expiry_date + create_time + _id` | 复合索引，升序 + 升序 + 升序 + 升序 + 升序 + 升序 | 支持按批次事务内按 FEFO 稳定读取领用候选 |
| `inventory` | `inventory.product_code + status + supplier_model_key + expiry_date + create_time + _id` | 复合索引，升序 + 升序 + 升序 + 升序 + 升序 + 升序 | 支持测试料型号维度事务内按 FEFO 稳定读取领用候选 |
| `inventory` | `inventory.product_code + status + batch_number + supplier_model_key + expiry_date + create_time + _id` | 复合索引，升序 + 升序 + 升序 + 升序 + 升序 + 升序 + 升序 | 支持测试料按批次和型号事务内按 FEFO 稳定读取领用候选 |
| `inventory` | `inventory.material_id + status` | 复合索引，升序 + 升序 | 支持主数据归档和单位锁定前检查库存记录 |
| `inventory` | `inventory.status + identity_key` | 复合索引，升序 + 升序 | 支持正式料按产品代码、测试料按“产品代码 + 原厂型号”聚合查询 |
| `inventory` | `inventory.status + expiry_date` | 复合索引，升序 + 升序 | 支持临期和风险库存筛选 |
| `inventory_log` | `inventory_log.type + project_code + timestamp desc + _id desc` | 复合索引，升序 + 升序 + 降序 + 降序 | 支持项目用料报表按项目和时间稳定导出 |
| `inventory_log` | `inventory_log.type + product_code + timestamp desc + _id desc` | 复合索引，升序 + 升序 + 降序 + 降序 | 支持项目用料报表按物料稳定反查 |
| `inventory_log` | `inventory_log.type + timestamp desc + _id desc` | 复合索引，升序 + 降序 + 降序 | 支持未限定项目或物料时稳定查询和导出项目用料 |
| `inventory_log` | `inventory_log.inventory_id + timestamp desc + _id desc` | 复合索引，升序 + 降序 + 降序 | 支持标签详情页稳定查看历史日志 |
| `inventory_log` | `inventory_log.unique_code + timestamp desc + _id desc` | 复合索引，升序 + 降序 + 降序 | 支持按标签编号稳定追溯日志 |
| `inventory_log` | `inventory_log.timestamp desc + _id desc` | 复合索引，降序 + 降序 | 支持日志列表按时间倒序稳定加载 |
| `audit_events` | `audit_events.timestamp desc + _id desc` | 复合索引，降序 + 降序 | 支持审计日志相同时间戳下稳定分页 |

创建步骤：

1. 打开微信开发者工具。
2. 进入“云开发”，并确认选择的是正式环境。
3. 进入“数据库”，选择需要配置的集合，例如 `inventory`。
4. 打开“索引”页签，点击“新建索引”。
5. 按上表字段顺序添加字段，并选择升序或降序。
6. 对 `users._openid`、`inventory.unique_code`、`materials.product_code`、`product_code_prefixes.prefix`、`test_material_identities.identity_key`、`preprinted_labels.unique_code`、`project_codes.project_code`、`material_subcategories.subcategory_key`、`warehouse_zones.zone_key` 和 `warehouse_location_details.detail_key` 勾选“唯一索引”。
7. 保存后等待索引构建完成，再继续大量导入或正式使用。

注意：

- `material_requests` 和 `inventory_correction_requests` 不直接对可变的 `status` 做唯一索引，否则第二条历史 rejected/approved 记录会被错误阻断。唯一约束应创建在只对 pending 写入的 `pending_key` 字段上。
- 唯一索引创建前必须确认集合中没有重复值，否则索引会创建失败。正式库已有重复 pending 记录时，先由业务人员确认，将多余记录改为 rejected 并保留原因，不自动删除。
- 索引构建期间不要批量导入大量数据。
- 索引创建完成后，建议重新测试库存查询、扫码领料、日志查看和库存导出。

### 7. 集合权限

正式环境的核心集合必须配置为“仅云函数可读写”，小程序端不直接读写数据库。至少包括：

- `users`、`materials`、`inventory`、`inventory_log`、`audit_events`
- `material_requests`、`inventory_correction_requests`
- `preprinted_labels`、`preprint_jobs`、`preprint_daily_usage`、`system_counters`
- `operation_receipts`
- `project_codes`、`material_subcategories`、`product_code_prefixes`、`test_material_identities`
- `warehouse_zones`、`warehouse_location_details`

在云开发控制台逐个检查集合权限；如果仍保留“所有用户可读”或“小程序端可写”，视为投产阻断项。

### 8. 依赖锁定

根目录和每个可部署云函数均提交 `package-lock.json`。依赖固定为 `@vant/weapp 1.11.7`、`wx-server-sdk 3.0.4`、`exceljs 4.4.0`，部署时选择“云端安装依赖”，不要删除锁文件后重新解析浮动版本。

### 9. 投产阻断检查

以下项目未完成时不要上传正式版小程序：

1. 已创建 `operation_receipts`、`audit_events`、`preprint_jobs`、`preprint_daily_usage`、`test_material_identities`，且保留原 `preprinted_labels` 与 `system_counters` 数据。
2. 本节要求的唯一索引和复合索引均已构建成功。
3. 核心集合权限均已收紧为仅云函数可读写。
4. 旧云端 `login`、`initMDMCollection`、`exportTestMaterialIdentityTemplate` 已删除。
5. 本次涉及的库存写入、标签、审批、项目报表、主数据与查询云函数均已重新部署。
6. 已执行 `npm run sync:shared` 和 `npm run release:check`，且正式库确认文件全部为 true。
7. 已在开发版完成 100 行分批入库及失败重试、并发申请、禁用用户写入拦截、日志和项目报表跨页、库存导出、模板导入和管理员盘点调整审计。

## 库区与详细坐标规则

- `存储区域` 表示大库位，例如 `防爆柜01`、`研发仓1`。
- `详细坐标` 表示大库位下的具体层位或点位。默认化材防爆柜会自动补齐 `F1` 至 `F5`，建议按 `F1` 为上层、`F5` 为下层理解。
- 系统会保存 `location_detail_key` 作为稳定 ID；管理员把 `F1` 改名为 `A` 后，当前库存展示会跟随新名称，历史日志仍保留当时操作快照。
- 单条入库、批量扫码入库、Excel 库存导入和移库都会校验详细坐标。有管理坐标的库区必须从下拉项中选择；未配置明细坐标的库区仍可填写自由文本。
- 导出最新库存入库模板后，`详细坐标*` 会提供当前启用坐标下拉。旧模板可兼容预览，但正式使用建议重新导出最新模板。

## 模板导入说明

物料主数据导入的当前正式流程是：

1. 管理员进入“物料导入”
2. 点击“导出最新模板”
3. 系统动态生成最新 `.xlsx` 模板并打开
4. 按模板填写
5. 保持为 `.xlsx`
6. 回到系统上传导入

注意：

- 不要复用旧模板
- 调整过子类别后，必须重新导出模板
- 模板只用于新建主数据，不用于覆盖更新现有主数据
- 物料主数据导入单次最多处理 100 条有效数据；库存模板导入和扫码批量入库前端单次最多保留 100 行，但按每批 10 行串行提交
- 某批失败时前序批次保留，任务和原始数据在本地保留 24 小时；重新进入页面可继续重试未完成批次，编辑失败行后会生成新的根操作号

## 开发与测试

### 运行测试

仓库根目录执行：

```bash
npm test
```

当前测试覆盖重点包括：

- 权限校验
- 库存分配顺序
- 模板导出与工作簿结构
- 膜材数量换算
- 搜索工具
- 导入逻辑
- 库区、详细坐标与子类别管理

### README 口径说明

本 README 以当前仓库真实实现为准，重点描述：

- 首页“顶部搜索”与“快捷领料”的职责边界
- `FEFO` 分配而非旧版 `FIFO` 描述
- 系统动态导出模板而非本地静态模板
- 普通用户、管理员、超级管理员三层角色边界

## 维护建议

- 修改预警阈值时，只编辑 `cloudfunctions/_shared/alert-config.js` 中的 `mass_g`、`volume_ml`、`length_m`，然后运行 `npm run sync:shared`，重新部署 `getDashboardStats` 与 `getInventoryGrouped`
- 修改库存分配规则时，请同时检查首页推荐、批次推荐和实际扣减逻辑
- 修改库区或详细坐标规则时，请同步检查单条入库、批量入库、模板导入、移库和库存导出
- 修改物料导入字段时，请同步更新：
  - `exportMaterialTemplate`
  - 导入解析与校验逻辑
  - 对应测试
- 修改测试料型号字段时，请同步更新：
  - `manageTestMaterialIdentity`
  - 物料主数据导入中的测试料行分流逻辑（不再维护独立测试料型号导入模板）
  - `cloudfunctions/_shared/test-material-identities.js` 及 `npm run sync:shared` 后的云函数副本
  - 入库、批量入库、库存模板导入和标签预生成的快照写入测试
- 新增页面或路由后，请同步更新 `miniprogram/app.json` 与本 README

## License

当前仓库以 `package.json` 中声明为准：`ISC`
