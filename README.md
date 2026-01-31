# 实验室库存管理小程序 (Lab Inventory Management)

这是一个基于微信小程序云开发（Cloud Development）构建的实验室库存管理系统。旨在解决实验室试剂、耗材的入库、领用、库存追踪及溯源管理问题。

---

## 📸 项目概览

项目采用 **原生微信小程序** 开发，结合 **Vant Weapp** 组件库打造现代简洁的 UI/UX。后端完全基于 **云开发 (Cloud Base)**，无需自建服务器。

### 核心功能

- **🧪 库存管理**
  - **入库 (Inbound)**: 支持扫码入库、手动录入。自动关联物料模版，支持批号 (Batch Number) 和有效期管理。
  - **领用 (Outbound)**: 扫码或搜索领用，支持按批次扣减库存，自动记录领用用途。
  - **移库/编辑**: 修改库存位置、数量及状态。
- **📊 数据可视化**
  - **库存聚合视图**: 按物料维度聚合展示总库存，点击可查看各批次详情。
  - **预警系统**: 临期耗材自动标记预警。
- **📝 审计与追踪**
  - **操作日志**: 全量记录入库、领用、修改、删除等操作，支持多维度筛选（时间、操作类型、操作人）。
  - **审计日志**: 管理员专用视图，提供更详尽的溯源能力。
- **👥 用户管理**
  - **注册与审核**: 新用户注册后需经管理员审核（Pending -> Active）方可使用。
  - **角色权限**: 区分普通用户与管理员（Admin）权限。

---

## 🛠 技术栈

- **前端**: 微信小程序原生 (WXML, WXSS, JS, JSON)
- **UI 组件库**: [Vant Weapp](https://vant-contrib.gitee.io/vant-weapp/)
- **后端**: 微信云开发 (WeChat Cloud Base)
  - **云函数 (Cloud Functions)**: 处理业务逻辑、权限校验、数据聚合。
  - **云数据库 (Cloud Database)**: NoSQL 数据库，存储物料、库存、日志及用户信息。

---

## 📂 目录结构

```text
├── cloudfunctions/        # 云函数目录
│   ├── getLogs/           # 获取日志（支持筛选搜索）
│   ├── searchInventory/   # 库存/物料搜索
│   ├── userLogin/         # 用户登录与鉴权
│   ├── ...                # 其他业务云函数
├── miniprogram/           # 小程序端源码
│   ├── components/        # 自定义组件 (Card, Dialog, Items)
│   ├── pages/             # 页面文件
│   │   ├── admin/         # 管理员相关页面
│   │   ├── inventory/     # 库存管理主页
│   │   ├── logs/          # 日志页面
│   │   ├── material-add/  # 入库/新建物料页面
│   │   └── ...
│   ├── app.js             # 全局逻辑与云初始化
│   ├── app.wxss           # 全局样式与设计令牌
│   └── ...
├── project.config.json    # 项目配置文件
└── ...
```

---

## 🚀 快速开始

### 1. 环境准备

- 安装 [Node.js](https://nodejs.org/) (用于安装依赖)
- 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### 2. 安装依赖

在项目根目录执行：

```bash
# 安装小程序端依赖
cd miniprogram
npm install

# 构建 npm (微信开发者工具 -> 工具 -> 构建 npm)
```

### 3. 配置云环境

1.  在微信开发者工具中开通 **云开发**。
2.  获取你的 **环境 ID (Env ID)**。
3.  修改 `miniprogram/app.js`:

```javascript
wx.cloud.init({
  env: "YOUR-ENV-ID-HERE", // 替换为你的环境 ID
  traceUser: true,
});
```

4.  **部署云函数**:
    - 在开发者工具中，右键点击 `cloudfunctions` 文件夹下的每个云函数目录（如 `getLogs`），选择 **"上传并部署：云端安装依赖"**。

### 4. 数据库初始化

需要在云数据库控制台中创建以下集合（Collection）：

- `users`: 用户信息
- `materials`: 物料基础信息模板
- `inventory`: 具体库存批次信息
- `inventory_log`: 操作日志

---

## 🔐 安全与隐私说明

本项目已配置 `.gitignore` 文件以防止敏感信息泄露：

- ✅ `project.private.config.json` (包含项目私有配置) 已被忽略。
- ✅ `node_modules` 已被忽略。
- ✅ `.env` 等包含环境变量的文件会被忽略。

**上传前检查清单**:

1.  确认 `miniprogram/app.js` 中的 `env` ID 是否是你希望公开的（Env ID 本身通常视为半公开信息，但若需完全保密，请在私有配置中处理）。
2.  确认代码中没有硬编码任何 `AppSecret` (本项目架构不应当包含 Secret)。

---

## 📄 License

[MIT](LICENSE)
