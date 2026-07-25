# 上线前一致性风险修复 - Implementation Plan

## Preparation

1. Load `trellis-before-dev` before editing product code.
2. Re-read the active search and test-material specs:
   - `.trellis/spec/frontend/search-ux-contracts.md`
   - `.trellis/spec/frontend/test-material-identity-contracts.md`
3. Confirm working tree is clean.

## Implementation checklist

### A. Test-material identity exact validation

1. Update `cloudfunctions/batchAddInventory/index.js`:
   - remove product-code-wide identity preload for validation;
   - validate each test-material row via exact identity lookup;
   - preserve identity snapshot merge before inventory payload creation.
2. Update `cloudfunctions/importInventoryTemplate/index.js`:
   - remove product-code-wide identity preload for submit validation;
   - validate each test-material row via exact identity lookup inside transaction;
   - preserve row-scoped error wording.
3. Add/adjust tests for >100 identities under one test material code.

### B. Similar identity detection

1. Update `cloudfunctions/manageTestMaterialIdentity/index.js`:
   - replace `.limit(100)` related-identity check with precise `similar_key` or paginated lookup.
2. Update `cloudfunctions/manageMaterial/index.js` material-import test identity creation path similarly.
3. Add/adjust tests for similar conflicts beyond 100 records.

### C. Release readiness gate

1. Update `scripts/release-readiness.example.json`.
2. Update `scripts/release-check.js`.
3. Update tests around deployment hardening/readiness.
4. If README requires new explicit wording for any new index, update README.

### D. Error response consistency

1. Update `cloudfunctions/exportLabelData/index.js` to use `handleCloudError`.
2. Update `cloudfunctions/approveMaterialRequest/index.js` to use `handleCloudError`.
3. Update `cloudfunctions/approveInventoryCorrectionRequest/index.js` to use `handleCloudError`.
4. Ensure business errors remain user-readable.
5. Add/adjust tests for unknown exception masking.

### E. Material request approval idempotency

1. Copy/sync operation receipt helper into `approveMaterialRequest` if not already present.
2. Wrap approve/reject transaction with receipt begin/reuse/success/failure semantics.
3. Add tests for retrying the same approval operation id.
4. Run `npm run sync:shared` if shared helper mappings change.

## Validation commands

Run in order:

```bash
npm test
git diff --check
npm run preflight:deploy
npm run release:check
```

Expected `release:check` outcome in this local workspace:

- If `scripts/release-readiness.json` is still absent, it should fail with the missing readiness file message.
- If a local production readiness file is manually supplied by the user later, it should enforce the expanded checklist.

## Risk points

- `operation_receipts` changes must not make approval retries create duplicate material records.
- Test-material identity exact lookup must not query outside transaction for write-time validation.
- Similar-model logic must not turn soft confirmation into a hard block.
- Release readiness example must not include real production values.

## Deployment note

After implementation, affected cloud functions to redeploy include at least:

- `batchAddInventory`
- `importInventoryTemplate`
- `manageMaterial`
- `manageTestMaterialIdentity`
- `exportLabelData`
- `approveMaterialRequest`
- `approveInventoryCorrectionRequest`
