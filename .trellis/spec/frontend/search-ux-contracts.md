# Search UX Contracts

This project uses WeChat mini-program pages backed by cloud functions. Search is a cross-layer contract: frontend trigger behavior, backend candidate selection, shared normalization, response metadata, and tests must stay aligned.

## Scenario: Unified search normalization and ranked list UX

### 1. Scope / Trigger

- Trigger: a page or cloud function accepts a user keyword for inventory, master data, test material identity, log, label, or project-usage search.
- Search code spans frontend pages, frontend utilities, cloud functions, copied shared cloud-function helpers, and tests.
- This contract applies to list-style search, selector suggestions, and navigation search. It does not replace domain-specific business filtering such as FEFO, risk sorting, audit timeline sorting, or export business order.

### 2. Signatures

- Frontend shared helper: `normalizeSearchKeyword(value) -> string`
- Frontend shared helper: `rankSearchResults(records, keyword, options?) -> rankedRecords`
- Cloud shared helper: `normalizeSearchKeyword(value) -> string`
- Cloud shared helper: `rankSearchResults(records, keyword, options?) -> rankedRecords`
- Search response metadata, when `keyword` / `searchVal` is non-empty:
  - `match_score: number`
  - `match_reason: string`
  - `match_field: string`
  - `searchTruncated?: boolean`
  - `searchMessage?: string`
- Master material list keeps the existing `searchVal` input and accepts `status: "active" | "archived" | "all"`.
- Test material identity list keeps the existing `searchVal` / `keyword` input and uses `includeDisabled: true` when global search must include disabled records.

### 3. Contracts

- Normalize by trimming, converting full-width characters to half-width, unifying dash variants to `-`, collapsing repeated whitespace, removing spaces around dashes, and uppercasing for matching.
- Escape user input before building database regular expressions. Regex metacharacters in user input are plain text, not executable patterns.
- Keep frontend and cloud helper implementations isomorphic. After changing `cloudfunctions/_shared/search.js`, run `npm run sync:shared` so local cloud-function copies match.
- Ranking scores are fixed:
  - `1000`: exact product code match.
  - `950`: exact test material model match.
  - `800`: product code or model prefix match.
  - `650`: exact material name match.
  - `500`: product code or model contains match.
  - `300`: auxiliary field contains match.
- Same-score sorting must include stable fields such as `product_code`, `supplier_model`, and `_id`.
- List pages use debounced refresh and request IDs to prevent stale responses from replacing newer input.
- Selector pages may show suggestions automatically, but they must not auto-select the first result. The user must tap a concrete candidate.
- Selectors whose candidate set can exceed one cloud page must remote-search and paginate by keyword; do not load the first 100 rows and then filter only in memory.
- Homepage navigation search is explicit: typing can load suggestions, but only enter/search action or tapping a suggestion navigates.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Empty or whitespace-only keyword | Treat as no search and restore the current browse mode. |
| Keyword contains regex characters such as `A+B(1)` | Match literal text after normalization; do not execute as regex syntax. |
| Keyword is broad and candidate count exceeds the function limit | Return `searchTruncated: true` and `searchMessage: "结果较多，请继续输入关键词"`. |
| Global master-data search has a keyword | Query material master data with `status: "all"` and test material identities with `includeDisabled: true`. |
| Archived material or disabled identity appears in global results | Display a status tag and do not allow it to become a new-business selector choice. |
| Logs, audit timelines, and project-usage reports have a keyword | Filter by keyword but keep timeline/business sorting, not relevance sorting. |
| A test-material code has more than 100 maintained supplier models | The model chooser must call the cloud list API with `product_code`, `searchVal`, `page`, and `pageSize`, and load more on scroll. |

### 5. Good/Base/Bad Cases

- Good: `normalizeSearchKeyword(" ｊ － ９９９ ")` returns `J-999`, and `J-999` ranks exact code matches before prefix and contains matches.
- Good: `J-9` shows `J-900` / `J-901` as candidates but does not rewrite the input or auto-select either one.
- Base: `99` is allowed as a broad contains search, with code/model matches ranked before auxiliary-field matches and a truncation notice when needed.
- Bad: homepage `onSearchChange` navigates to `/pages/inventory/index` after a timer fires.
- Bad: a cloud function introduces a private search normalizer that does not match `cloudfunctions/_shared/search.js`.

### 6. Tests Required

- Search helper tests for case, full-width/half-width, dash variants, whitespace, regex literal handling, exact/prefix/contains ranking, and stable tie-breaks.
- Page behavior tests for homepage explicit navigation, list debounce, request ID stale-response protection, clear behavior, and selector manual selection.
- Master-data tests for grouped material plus test identity search, parent material display, archived/disabled tags, and `status: "all"` / `includeDisabled: true`.
- Backend query tests for candidate truncation metadata and unchanged timeline/business ordering in logs, reports, and exports.
- Deployment checks must include shared helper synchronization so copied cloud-function `search.js` files cannot drift.

### 7. Wrong vs Correct

#### Wrong

```js
// Private normalizer: only trims and lowercases.
const keyword = String(searchVal || '').trim().toLowerCase();
setTimeout(() => wx.navigateTo({ url: `/pages/inventory/index?search=${keyword}` }), 500);
```

#### Correct

```js
const { normalizeSearchKeyword } = require('../../utils/search');

const keyword = normalizeSearchKeyword(searchVal);
if (!keyword) {
  restoreBrowseMode();
  return;
}

// List pages refresh after debounce; homepage waits for explicit search action.
loadListWithRequestGuard({ searchVal });
```

## Scenario: Label preprint selector safety

### 1. Scope / Trigger

- Trigger: the label export page pre-generates printable label records from a selected material.
- This is a selector workflow, not free-form material creation. The UI, payload, and `exportLabelData` cloud function must all preserve the same selected material boundary.
- The reprint workflow is different: it exports existing `inventory` rows selected from the in-stock list and must not accept free-form label fields from the page.

### 2. Signatures

- Frontend page state: `preprintForm.selectedMaterial` is required before print settings and preprint actions are shown.
- Preprint payload: `{ templateType, materialId, count, form: { supplier_model, supplier_model_key, thickness_um, width_mm, supplier, sample_note } }`.
- Backend material lookup: `loadMaterialForPreprint(data) -> active material record` by `materialId` or `productCode`.
- Backend label row builder: `buildPreprintLabelRecords({ templateType, labelCodes, material, form, ... }) -> preprinted label records`.
- Reprint export payload: `{ templateType, selectedIds }`, where `selectedIds` are existing `inventory` document ids.

### 3. Contracts

- The preprint UI must hide or disable generation settings until the user enters a governed product-code prefix plus a 1–3 digit number and the page resolves one active material by exact product code. Name search is not part of this workflow.
- Test-material preprints must use an enabled `test_material_identities` record. The UI shows a readonly model field and opens a searchable chooser limited to the selected test-material code shell; the backend revalidates the `supplier_model_key`.
- Formal-material preprints must use `material.supplier_model` as the printable supplier model. Request-provided `form.supplier_model` and `form.supplier_model_key` must not override master data for formal materials.
- If a formal material has no supplier model in master data, the printable model is blank. The label preprint page should not show a warning or ask the operator to enter an ad-hoc model there.
- Film preprints still require thickness and width after a material is selected. Governed formal-film specs may be readonly when master data supplies them; test-film batch specs may be entered as the label snapshot.
- Reprint exports must load selected in-stock inventory rows by id and category, then build labels from inventory/material snapshots. Reprint must not take free-form material, supplier model, batch, or location fields from the client.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No selected material when preprint action is tapped | Frontend rejects with "请先从搜索结果中选择物料"; backend rejects missing material id/product code. |
| Material id no longer exists | Backend rejects with "未找到对应物料主数据". |
| Material is archived/disabled | Backend rejects with "所选物料未启用，不能预生成标签". |
| Test material has no selected enabled identity | Frontend rejects before submit; backend rejects with the test-material identity error. |
| Formal material payload includes ad-hoc supplier model | Backend ignores it and uses `material.supplier_model` only. |
| Reprint selected inventory is no longer in stock or category mismatches the template | Backend rejects and asks the operator to refresh. |

### 5. Good/Base/Bad Cases

- Good: operator selects prefix `J`, enters `999`, the page resolves `J-999`, chooses `TEST-CHEM-01` from the enabled identity chooser, then generates labels.
- Good: operator selects a formal material with `supplier_model = MASTER-MODEL`; even if the client sends `TEMP-MODEL`, exported labels use `MASTER-MODEL`.
- Base: formal material has no supplier model; generated labels leave the model cell blank without showing an extra warning on the preprint page.
- Bad: showing editable print settings before any material is selected, because it suggests a label can be generated from free text.
- Bad: reprint export accepts client-provided supplier model instead of reading existing inventory rows.

### 6. Tests Required

- Page tests assert that preprint settings are gated by `preprintForm.selectedMaterial`.
- Page tests assert formal-material supplier model input is readonly and has no `data-field="supplier_model"` free-form binding.
- Backend tests assert formal-material preprint records and request signatures ignore request-provided `supplier_model` / `supplier_model_key`.
- Backend tests assert test-material preprints still require maintained and enabled identity records.
- Reprint tests assert selected ids are filtered by `status: "in_stock"` and template category before export.

### 7. Wrong vs Correct

#### Wrong

```js
// Formal material preprint accepts ad-hoc label model from the page.
const supplierModel = form.supplier_model || material.supplier_model;
```

#### Correct

```js
// Formal material labels are governed by master data; test materials use the identity chooser.
const supplierModel = material.is_test_material
  ? selectedIdentity.supplier_model
  : material.supplier_model;
```
