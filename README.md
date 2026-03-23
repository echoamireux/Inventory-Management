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

### 5. 主数据与导入模板治理

系统当前的正式导入模板来源，是管理员在系统内动态导出的最新 `.xlsx` 模板：

- 模板由 `exportMaterialTemplate` 云函数按当前子类别、单位和说明动态生成
- 管理员填写后需另存为 `.csv` 再回到系统上传导入
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
- 物料查询
- 物料管理
- 操作日志
- 审计日志

日志链路支持按产品代码、物料名称、标签编号、批号、操作人、类型、描述、备注等信息检索，便捷领用与精确领用最终都会落到实际标签日志，保证追溯能力。

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
  在管理员基础上，可调整用户角色

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
  物料查询
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
- `pages/admin/zone-manage/index`
  库区管理
- `pages/admin/subcategory-manage/index`
  子类别管理
- `pages/super-admin/user-manage/index`
  超级管理员用户管理

## 关键云函数

当前仓库中与核心业务直接相关的主要云函数包括：

- `login` / `userLogin` / `registerUser`
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
  单条新增物料与库存
- `manageMaterial`
  主数据列表、编辑、归档、恢复等
- `addMaterialRequest` / `approveMaterialRequest`
  建档申请与审批
- `exportMaterialTemplate`
  动态导出最新导入模板
- `exportData`
  导出报表
- `manageSubcategory`
  子类别管理
- `addWarehouseZone`
  库区管理
- `getLogs`
  日志查询
- `adminUpdateUserStatus`
  管理员审批用户状态

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
│   ├── addWarehouseZone/             # 库区管理
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
cd cloudfunctions
chmod +x sync_shared.sh
./sync_shared.sh
cd ..
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

建议首次接手项目时至少重新部署以下函数：

- `login`
- `registerUser`
- `getDashboardStats`
- `getInventoryGrouped`
- `getInventoryBatches`
- `updateInventory`
- `manageMaterial`
- `exportMaterialTemplate`
- `getLogs`

### 6. 数据库建议

建议为高频查询字段建立索引，至少包括：

- `inventory.product_code`
- `inventory.unique_code`
- `inventory.batch_number`
- `inventory.status`
- `inventory.create_time`
- `inventory_log.timestamp`
- `inventory_log.unique_code`

## 模板导入说明

物料主数据导入的当前正式流程是：

1. 管理员进入“物料导入”
2. 点击“导出最新模板”
3. 系统动态生成最新 `.xlsx` 模板并打开
4. 按模板填写
5. 另存为 `.csv`
6. 回到系统上传导入

注意：

- 不要复用旧模板
- 调整过子类别后，必须重新导出模板
- 模板只用于新建主数据，不用于覆盖更新现有主数据

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
- 库区与子类别管理

### README 口径说明

本 README 以当前仓库真实实现为准，重点描述：

- 首页“顶部搜索”与“快捷领料”的职责边界
- `FEFO` 分配而非旧版 `FIFO` 描述
- 系统动态导出模板而非本地静态模板
- 普通用户、管理员、超级管理员三层角色边界

## 维护建议

- 修改预警阈值时，请同步检查前后端共享配置
- 修改库存分配规则时，请同时检查首页推荐、批次推荐和实际扣减逻辑
- 修改物料导入字段时，请同步更新：
  - `exportMaterialTemplate`
  - 导入解析与校验逻辑
  - 对应测试
- 新增页面或路由后，请同步更新 `miniprogram/app.json` 与本 README

## License

当前仓库以 `package.json` 中声明为准：`ISC`
