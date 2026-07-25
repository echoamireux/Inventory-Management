# 测试料型号选择器云端分页搜索设计

## Current Problem

`listTestMaterialIdentities({ pageSize: 100 })` 当前被标签打印、单个入库和批量入库弹窗用作一次性加载。弹窗随后调用前端 `filterTestMaterialIdentityActions()` 做本地筛选。若一个测试料产品代码下有 100 条以上型号，后续型号不会进入本地候选集，用户输入关键词也搜不到。

## Target Behavior

- Selector data source becomes remote and paginated.
- Each selector request includes:
  - `product_code` / `material_id`
  - `includeDisabled: false`
  - `searchVal`
  - `page`
  - `pageSize`
- Frontend keeps:
  - loaded actions
  - total
  - page
  - isEnd
  - request id
  - search message
- Input changes reset page to 1 and issue a new remote request.
- Scroll-to-bottom loads next page.
- Stale responses are ignored by request id.

## Backend Contract

`manageTestMaterialIdentity.list` already supports product-code filtering, keyword filtering, pagination, and `searchMessage`. The current page-size cap of 100 is acceptable as a per-request cap. The selector should not request all rows; it should page through results. No database schema change is required.

For broad keyword searches, backend currently ranks up to `MAX_SEARCH_CANDIDATES = 200`. That is acceptable as a candidate guard for now, as long as UI surfaces `searchMessage`. Future improvement can move to cursor/search-token pagination if one keyword can legitimately match thousands of rows.

## Frontend Contract

Use one shared frontend helper for selector state and remote loading to avoid three independent implementations drifting:

- build list actions from backend records with existing `buildTestMaterialIdentityActions`.
- remote search returns `{ actions, total, page, pageSize, isEnd, searchMessage }`.
- local filtering remains available for already-loaded lists only where explicitly appropriate, but selector search must use remote data.

## Scope

Modify:

- `miniprogram/utils/test-material-identity-service.js`
- `miniprogram/pages/admin/label-export/index.js`
- `miniprogram/pages/material-add/index.js`
- `miniprogram/pages/material-add/batch-entry.js`
- `miniprogram/pages/admin/test-material-identity-manage/index.js`
- related WXML/WXSS/tests/specs

Do not modify:

- product-code first-layer exact lookup
- inventory data model
- collection names or indexes
- batch stock-in transaction protocol
