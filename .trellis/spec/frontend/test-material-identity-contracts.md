# Test Material Identity Contracts

## Scenario: test material master data and identity library split

### 1. Scope / Trigger

- Trigger: changing material master-data forms, test material identity library pages, import templates, or stock-in / label-preprint flows that consume test material identities.
- This contract spans mini-program pages, frontend utilities, cloud functions, copied shared cloud helpers, workbook templates, and tests.

### 2. Signatures

- Material master record:
  - `materials.is_test_material: boolean`
  - `materials.product_code: string`
  - `materials.category: "chemical" | "film"`
  - `materials.supplier: ""` for test materials
  - `materials.supplier_model: ""` for test materials
- Test material identity record:
  - `test_material_identities.product_code: string`
  - `test_material_identities.supplier_model: string`
  - `test_material_identities.supplier_model_key: string`
  - `test_material_identities.supplier?: string`
  - `test_material_identities.identity_key: "<category>::<product_code>::<supplier_model_key>"`
- Frontend selector action:
  - `{ name, value, supplier_model, supplier_model_key, supplier, identity_key, material_id, product_code }`

### 3. Contracts

- Test material master data is only a code shell: product code, category, subcategory, default unit, specs, and `is_test_material`.
- Test-material master-data forms should ask for `is_test_material` before `material_name`; when enabled, default `material_name` to `测试料` and select the built-in `测试料` subcategory for the chosen category.
- Real supplier models for test materials live only in `test_material_identities`, not in `materials.supplier_model`.
- `test_material_identities.supplier` is optional metadata and a default supplier, not an identity key.
- New test material identity UI must choose an existing active test-material master record; it must not let users type an unregistered product code.
- Test material identity import templates use three columns: `测试料产品代码*`, `原厂型号*`, `供应商（选填）`.
- Stock-in, batch stock-in, inventory-template import, and label preprint may use identity supplier as a default only when the user/request supplier is blank.
- Reprint/export flows use inventory or preprinted-label snapshots and must not retroactively read changed identity supplier values.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Saving a test-material master record with supplier fields present | Clear `supplier` and `supplier_model` before writing. |
| Enabling the test-material switch on a master-data form | Default the name to `测试料`, select the built-in `测试料` subcategory when the category is known, and keep supplier fields blank. |
| Creating an identity without an active test-material master record | Reject with a business message asking the admin to maintain the test-material code shell first. |
| Creating an identity without supplier model | Reject with `请输入原厂型号`. |
| Same product code + normalized supplier model appears again | Reject as duplicate, regardless of supplier. |
| Same product code + case-only or whitespace-only similar supplier model appears | Return similar-model confirmation flow; do not hard-block unless the exact normalized identity key matches. |
| User has already entered supplier on stock-in/preprint | Preserve the user value; do not override from identity supplier. |
| User leaves supplier blank and identity has supplier | Default supplier from the selected identity into the snapshot. |

### 5. Good/Base/Bad Cases

- Good: `J-999` test master has blank `materials.supplier_model`; identities `MODEL-A` and `MODEL-B` are maintained in `test_material_identities`.
- Good: identity `MODEL-A` with supplier `供应商A` defaults supplier during stock-in when the form supplier is blank.
- Base: identity supplier is blank; stock-in supplier remains blank unless the user fills it.
- Bad: storing `MODEL-A` in `materials.supplier_model` for `J-999`.
- Bad: allowing two `J-999 + MODEL-A` identities just because suppliers differ.
- Base: `A C` and `AC` are not exact duplicates, but they must trigger the similar-model confirmation flow.

### 6. Tests Required

- Page tests assert test-material master forms hide/clear supplier fields.
- Backend tests or static contract tests assert `manageMaterial` clears supplier fields for test materials.
- Identity tests assert supplier normalization, supplier persistence, supplier search, and identity key excluding supplier.
- Identity tests assert similar-model detection ignores case and all whitespace while exact duplicate detection preserves the normalized identity key.
- Template tests assert three-column headers, v2 template protocol, and product-code dropdown preservation.
- Stock-in and preprint tests assert identity supplier defaults only when request supplier is blank.

### 7. Wrong vs Correct

#### Wrong

```js
const identityKey = `${category}::${productCode}::${supplierModelKey}::${supplier}`;
const supplier = material.supplier || identity.supplier;
```

#### Correct

```js
const identityKey = `${category}::${productCode}::${supplierModelKey}`;
const supplier = requestSupplier || identity.supplier || '';
```
