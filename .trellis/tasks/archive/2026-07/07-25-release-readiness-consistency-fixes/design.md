# 上线前一致性风险修复 - Design

## Overview

This task hardens release readiness and test-material identity validation without changing the inventory domain model.

The design keeps the existing split:

- `materials` owns formal material master data and test-material code shells.
- `test_material_identities` owns test-material supplier model identity, user-facing material name, subcategory, and optional default supplier.
- Stock-in and preprint flows snapshot identity fields into inventory/preprinted labels so history stays stable.

## D1. Exact test-material identity lookup for write paths

Current risk:

- Batch stock-in and inventory template stock-in pre-load identities by product code and then perform in-memory matching.
- With more than one cloud database page of identities under one product code, a valid supplier model can be absent from the preloaded candidate list and be rejected.

Design:

- Keep shared `loadTestMaterialIdentityForSelection(collectionOwner, material, source)` as the canonical exact lookup helper.
- Use the helper in write transactions for each test-material row.
- Resolve each row by `identity_key`, derived from category + product code + normalized supplier model key.
- Merge returned identity snapshot into the prepared stock-in item before inventory payload creation.

Expected effect:

- Write paths no longer depend on loading all identities under a product code.
- Existing status and missing-model business errors stay unchanged.
- Existing `test_material_identities.identity_key` unique index remains the hard uniqueness boundary.

## D2. Similar-model detection beyond 100 records

Current risk:

- Manual identity create/update and material import similar checks call `limit(100)`.
- Exact duplicate protection is safe, but similar warnings can miss records beyond the first page.

Design:

- Prefer precise `similar_key` lookup where practical:
  - `category`
  - `product_code`
  - `similar_key`
- Fall back to paginated full scan only if needed for local/mock compatibility.
- Continue excluding the current record on update.

Compatibility:

- Existing records already normalize to `similar_key` at write time in the current code path.
- The production index list should document and readiness-check a supporting composite index if code relies on this query.

## D3. Release readiness gate alignment

Current risk:

- README documents a broader production checklist than `release-check.js` enforces.
- A user could create `release-readiness.json` from the example, set all listed values true, and still miss preprint-related collections/indexes.

Design:

- Treat `release-readiness.example.json` as the authoritative local template.
- Make `release-check.js` enforce the same critical checklist buckets:
  - required collections, including preprint and counter collections;
  - required indexes, including test material, preprint, configuration, FEFO, log, request dedupe indexes;
  - core collection ACL;
  - retired cloud function cleanup.
- Keep the file ignored by Git; do not include real production answers.

## D4. Cloud error response consistency

Current risk:

- Some critical functions return raw `err.message` for unknown errors.

Design:

- Copy/use the shared `handleCloudError` helper in affected functions.
- Preserve public business messages generated intentionally for validation and workflow states.
- Hide unknown technical details behind fallback messages.
- Include scope and operation id/request id where available.

Affected functions:

- `exportLabelData`
- `approveMaterialRequest`
- `approveInventoryCorrectionRequest`

## D5. Material approval idempotency

Current risk:

- `approveMaterialRequest` does not use `operation_receipts`, even though callers submit operation ids.
- A timeout after a successful approve can lead to a retry response such as “该申请已被处理过”, which is technically safe but operationally confusing.

Design:

- Build an operation receipt context from:
  - operator OPENID
  - `event.operation_id`
  - request id
  - action
  - reject reason
- Begin the receipt inside the transaction after the current request is loaded.
- On reused receipt, return the stored response.
- Mark success or known terminal failure inside the same transaction.
- Preserve audit/business writes in the same transaction.

## Rollout / rollback

- No database migration beyond index/readiness documentation is performed by code.
- If any behavior regresses, rollback is a normal Git revert plus redeploy affected cloud functions.
- Production release remains manually gated by `npm run release:check` and WeChat Developer Tools.
