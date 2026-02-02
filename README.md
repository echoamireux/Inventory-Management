# 实验室库存管理小程序 (Lab Inventory Management)

这是一个基于 **微信小程序云开发 (Cloud Development)** 构建的现代化实验室库存管理系统。旨在解决实验室试剂、耗材的入库、领用、库存追踪及溯源管理问题，特别针对数据的准确性、并发安全性和审计可追溯性进行了深度优化。

---

## 🌟 核心特性 (Key Features)

### 1. 🛡 强健的库存逻辑 (Robust Inventory Logic)

- **严格先进先出 (FIFO)**: 领用逻辑强制按 `create_time` 顺序扣减库存批次，确保老批次优先出库。
- **原子性事务 (Atomic Transactions)**: 批量入库 (`batchAddInventory`) 和库存更新 (`updateInventory`) 均由数据库事务包裹，确保高并发下的数据一致性，杜绝“超卖”或数据部一致。
- **高精度计算**: 引入 `EPSILON` 机制处理 JavaScript 浮点数运算，彻底解决 `0.30000000004` 类微量库存残留问题。

### 2. 🌍 智能时区处理 (Smart Timezone)

- **环境无关性**: 后端逻辑采用纯数学计算处理 **UTC+8 (CST)** 时区，无论云函数运行在何种时区环境（UTC 或 Local），均能精准计算“北京时间”的 0点及临期时间，消除 8 小时偏差。
- **标准化临期预警**: 前后端统一使用 `alert-config.js` 配置，避免硬编码导致的不一致。

### 3. 🧪 科学的物料管理

- **双重校验**: 入库时进行 `unique_code` 的应用层与数据库层双重唯一性校验。
- **完备的日志审计**: 详细记录每一次入库、领用、归档、还原操作，支持按操作人、时间段溯源。

---

## 📸 功能概览

- **📝 入库管理 (Inbound)**
  - 支持扫码/手动录入，批号效期自动关联。
  - **批量导入**: 支持一次性导入多条数据，事务保障全成功或全失败。
- **📦 领用管理 (Outbound)**
  - 智能扣减：输入领用总量，系统自动计算需扣减的批次和数量。
  - 支持归还与报损逻辑。
- **📈 仪表盘 (Dashboard)**
  - 实时概览：总库存种类、今日出入库动态。
  - **临期预警**: 自动计算并高亮显示即将过期的试剂（默认 30 天，可配置）。
- **👥 权限体系**
  - **Admin**: 全局管理、日志审计、配置修改。
  - **User**: 仅限日常出入库操作。

---

## 🛠 技术栈

- **前端**: 微信小程序原生 (WXML, WXSS, JS) + Vant Weapp 组件库
- **后端**: 微信云开发 (Cloud Base) - Node.js 环境
- **数据库**: 云数据库 (NoSQL)

---

## 📂 目录结构

```text
├── cloudfunctions/             # 云函数根目录
│   ├── _shared/                # [NEW] 公共依赖模块 (配置、工具类)
│   │   ├── alert-config.js     # 全局预警阈值配置
│   │   └── response.js         # 统一响应格式
│   ├── sync_shared.sh          # [NEW] 配置同步脚本 (核心)
│   ├── addMaterial/            # 新增物料 (含事务校验)
│   ├── batchAddInventory/      # 批量入库 (含事务回滚)
│   ├── updateInventory/        # 库存扣减 (FIFO + 精度控制)
│   ├── getDashboardStats/      # 仪表盘统计 (时区修正版)
│   ├── getInventoryGrouped/    # 库存聚合 (时区修正版)
│   └── ...
├── miniprogram/                # 小程序前端
│   ├── utils/
│   │   ├── alert-config.js     # (由脚本自动同步的前端配置)
│   │   └── ...
│   ├── pages/                  # 业务页面
│   └── ...
└── ...
```

---

## 🚀 快速开始

### 1. 环境准备

- 安装 [Node.js](https://nodejs.org/)
- 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### 2. 初始化与配置同步 (关键步骤)

本项目采用了**共享配置**策略。在首次拉取代码或修改配置后，**必须**运行同步脚本：

```bash
# 1. 进入云函数目录
cd cloudfunctions

# 2. 赋予脚本执行权限 (仅需一次)
chmod +x sync_shared.sh

# 3. 执行同步
./sync_shared.sh
```

> _该脚本会自动将 `_shared/alert-config.js` 分发到各个云函数及小程序前端目录，确保全系统配置统一。_

### 3. 配置云环境

1.  在微信开发者工具中开通 **云开发** 并获取 **环境 ID (Env ID)**。
2.  进入 `miniprogram` 目录，复制配置模板：
    ```bash
    cd miniprogram
    cp env.example.js env.js
    ```
3.  编辑 `miniprogram/env.js`，填入你的真实 ID：

    ```javascript
    module.exports = {
      env: "YOUR-REAL-ENV-ID", // 填入环境 ID
      traceUser: true,
    };
    ```

    > 注意：`env.js` 已被 `.gitignore` 忽略，不会上传到代码仓库，确保你的环境 ID 安全。

4.  **部署云函数**:
    - 在开发者工具中，右键点击 `cloudfunctions` 文件夹下的每个云函数目录，选择 **"上传并部署：云端安装依赖"**。
5.  建议全量重新部署一次以确保依赖更新。

### 4. 数据库索引

请确保 `inventory` 集合的 `create_time` 和 `product_code` 字段已建立索引，以优化排序和查询性能。

---

## 🔐 维护指南

- **修改预警阈值**: 编辑 `cloudfunctions/_shared/alert-config.js`，然后运行 `./sync_shared.sh`。
- **修改时区逻辑**: 核心逻辑位于 `getDashboardStats/index.js`，基于 UTC 时间戳进行数学运算，无需依赖服务器本地时间设置。

---

## 📄 License

[MIT](LICENSE)
