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
