# 上线前一致性风险修复

## Goal

在不改变现有库存模型、权限模型、测试料主数据/型号库拆分模型的前提下，修复本次上线前审查发现的业务一致性和发布闸门风险，使系统从“开发版可试用”推进到“正式上线前可验证”的状态。

用户价值：

- 测试料型号数量增长后，入库、模板导入和型号维护仍能稳定工作。
- 正式发布检查不只依赖人工记忆，而是覆盖 README 中声明的集合、索引、ACL 和旧云函数清理要求。
- 关键写操作在网络重试和未知异常时表现一致，不误导用户，也不暴露技术细节。

## Confirmed Facts

- 当前分支为 `codex/test-material-identity-governance`，工作区干净。
- `npm test` 当前为 `557/557` 通过。
- `npm run preflight:deploy` 当前通过。
- `npm run release:check` 当前失败，原因是缺少被 `.gitignore` 忽略的 `scripts/release-readiness.json`。
- README 要求正式库确认 `preprint_jobs`、`preprint_daily_usage`、保留/配置 `preprinted_labels` 和 `system_counters`，但 `scripts/release-check.js` 与 `scripts/release-readiness.example.json` 当前只强制确认少数集合。
- 测试料模型已经确定：`materials` 中测试料仅是产品代码壳，真实现场名称、子类别、原厂型号来自 `test_material_identities`。
- 前端测试料型号选择器已经远程分页搜索，但部分后端写入校验和相似型号检查仍存在只加载一页候选的风险。
- 系统不新增集合，不引入后台 worker，不引入 CI 自动部署。

## Requirements

### R1. 测试料入库校验必须支持单个代码下超过 100 个型号

- `batchAddInventory` 不得再通过“按产品代码加载所有测试料型号”来校验批量入库行。
- `importInventoryTemplate` 不得再通过“按产品代码加载所有测试料型号”来校验模板入库提交行。
- 后端应按每行测试料选择的规范身份精确校验，例如 `identity_key` 或 `product_code + status + supplier_model_key`。
- 校验成功后仍必须把测试料型号库中的 `label_material_name`、`subcategory_key`、`sub_category`、`supplier_model`、`supplier_model_key`、可用默认 `supplier` 写入库存快照。
- 测试料型号未维护或已停用时，继续返回现有业务提示，不得静默放行。

### R2. 测试料相似型号提醒不得只检查前 100 条

- `manageTestMaterialIdentity` 新增/更新相似型号检查需要覆盖同一测试料产品代码下的全部相关型号，或使用可精确命中的相似键查询。
- 物料主数据导入创建测试料型号时，相似型号检查也需要覆盖同一产品代码下的全部相关型号，避免第 101 条以后漏提示。
- 精确重复仍以 `identity_key` 唯一索引为最终兜底；相似型号只提醒，不新增硬性重复规则。
- `A C` 与 `AC` 仍不是精确重复，但应触发相似提醒；前后空格、大小写和多余空格按既有规范化规则处理。

### R3. 发布 readiness 闸门必须与 README 投产要求一致

- `scripts/release-check.js` 和 `scripts/release-readiness.example.json` 必须补齐 README 中投产阻断项涉及的集合、索引与旧云函数清理确认。
- 至少补充预打印链路相关确认：`preprinted_labels`、`preprint_jobs`、`preprint_daily_usage`、`system_counters`。
- 至少补充 README 已声明但当前 readiness 未强制的关键索引确认：`test_material_identities.identity_key`、`test_material_identities.product_code + status + supplier_model_key`、`test_material_identities.material_id + status + updated_at desc`、预打印相关索引、主数据/配置唯一索引。
- `release:check` 仍必须在缺少本地 `scripts/release-readiness.json` 时失败。
- 不把真实正式环境 ID 或 readiness 真值文件提交到仓库。

### R4. 关键云函数未知异常返回要统一

- `exportLabelData` 未知异常不得直接把底层技术 `error.message` 暴露给前端。
- `approveMaterialRequest` 和 `approveInventoryCorrectionRequest` 未知异常不得直接拼接 `err.message` 暴露给前端。
- 已知业务错误仍应保持用户可理解提示。
- 服务端日志应保留详细异常和操作号/请求号信息，方便排查。

### R5. 物料申请审批要补齐幂等一致性

- `approveMaterialRequest` 后端应使用前端已传入的 `operation_id` 建立 `operation_receipts`。
- 同一管理员、同一申请、同一动作在网络超时后重试，应返回原审批结果，而不是仅返回“该申请已被处理过”。
- 重试 payload 与原 payload 不一致时，应保持现有 operation receipt 签名冲突保护。
- 审批通过/驳回仍必须事务内写业务数据和审计事件。

### R6. 不改变的边界

- 不改变测试料代码壳和型号库拆分模型。
- 不新增数据库集合。
- 不恢复独立测试料型号导入模板。
- 不改变批量入库 100 行、每 10 行分批、失败批次可恢复协议。
- 不改变管理员可直接盘点调整和可审批自己提交纠错的业务选择。
- 不引入 GitHub Actions 或自动部署。

## Acceptance Criteria

- [ ] `npm test` 通过，且现有 557 个测试不得减少。
- [ ] `npm run preflight:deploy` 通过。
- [ ] `npm run release:check` 在缺少本地 `scripts/release-readiness.json` 时继续失败，并提示正式库确认文件缺失。
- [ ] 测试覆盖：单个测试料代码下超过 100 个型号时，扫码批量入库能校验并写入第 101 条以后的合法型号。
- [ ] 测试覆盖：单个测试料代码下超过 100 个型号时，库存模板导入能校验并写入第 101 条以后的合法型号。
- [ ] 测试覆盖：第 101 条以后的相似测试料型号仍会触发相似提醒。
- [ ] 测试覆盖：`release-readiness.example.json` 与 `release-check.js` 对 README 声明的关键投产集合/索引保持一致。
- [ ] 测试覆盖：`exportLabelData`、`approveMaterialRequest`、`approveInventoryCorrectionRequest` 未知异常返回通用提示，已知业务错误保留可读提示。
- [ ] 测试覆盖：`approveMaterialRequest` 网络重试复用同一 `operation_id` 时返回原结果，不重复创建或错误误导。
- [ ] `git diff --check` 通过。

## Out of Scope

- 不执行真实云数据库索引创建。
- 不生成或提交真实 `scripts/release-readiness.json`。
- 不重新部署云函数；只更新代码和文档/测试。
- 不重构 `searchInventory` 是否退役的问题；可作为后续优化。
- 不清理小程序端普通 debug 日志；本任务只处理正式上线风险项。

## Open Questions

无。当前范围来自上线前全盘审查结论，用户已确认按建议修复。
