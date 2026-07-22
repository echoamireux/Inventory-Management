#!/bin/bash
set -euo pipefail

# Cloud Functions Shared File Synchronizer
# Usage: ./sync_shared.sh
#
# Run this script after modifying any file in `cloudfunctions/_shared/`
# to propagate changes to dependent functions.

echo "🔄 Syncing shared files..."

# 1. Sync Alert Config
echo "   -> Updating alert-config.js..."
cp cloudfunctions/_shared/alert-config.js cloudfunctions/getInventoryGrouped/alert-config.js
cp cloudfunctions/_shared/alert-config.js cloudfunctions/getDashboardStats/alert-config.js
cp cloudfunctions/_shared/low-stock.js cloudfunctions/getInventoryGrouped/low-stock.js
cp cloudfunctions/_shared/low-stock.js cloudfunctions/getDashboardStats/low-stock.js

# 2. Sync Response Helper
# (Only searchInventory uses it currently, but good to track)
echo "   -> Updating response.js..."
cp cloudfunctions/_shared/response.js cloudfunctions/searchInventory/response.js

# 3. Sync Auth Helper
echo "   -> Updating auth.js..."
cp cloudfunctions/_shared/auth.js cloudfunctions/adminUpdateUserStatus/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/addMaterial/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/addMaterialRequest/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/approveMaterialRequest/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/approveInventoryCorrectionRequest/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/removeInventory/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/removeLog/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/batchRemoveLog/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/batchAddInventory/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/addWarehouseZone/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/editInventory/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/manageSubcategory/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/manageMaterial/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/manageProductCodePrefix/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/manageTestMaterialIdentity/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportMaterialTemplate/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportTestMaterialIdentityTemplate/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportInventoryTemplate/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportLabelData/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportData/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getDashboardStats/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getInventoryGrouped/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getInventoryBatches/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getLogs/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getOperators/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/searchInventory/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/manageProjectCode/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getProjectUsageReport/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/exportProjectUsageReport/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getInventoryRecord/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/getApprovalCenterData/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/importInventoryTemplate/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/submitInventoryCorrectionRequest/auth.js
cp cloudfunctions/_shared/auth.js cloudfunctions/updateInventory/auth.js

# 4. Sync Film Quantity Helper
echo "   -> Updating film-quantity.js..."
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/addMaterial/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/approveInventoryCorrectionRequest/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/batchAddInventory/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/editInventory/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/importInventoryTemplate/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/updateInventory/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/getInventoryGrouped/film-quantity.js
cp cloudfunctions/_shared/film-quantity.js cloudfunctions/exportData/film-quantity.js

echo "   -> Updating inventory-quantity.js..."
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/addMaterial/inventory-quantity.js
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/approveInventoryCorrectionRequest/inventory-quantity.js
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/batchAddInventory/inventory-quantity.js
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/editInventory/inventory-quantity.js
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/importInventoryTemplate/inventory-quantity.js
cp cloudfunctions/_shared/inventory-quantity.js cloudfunctions/updateInventory/inventory-quantity.js

echo "   -> Updating operation-receipts.js..."
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/addMaterial/operation-receipts.js
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/approveInventoryCorrectionRequest/operation-receipts.js
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/batchAddInventory/operation-receipts.js
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/editInventory/operation-receipts.js
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/importInventoryTemplate/operation-receipts.js
cp cloudfunctions/_shared/operation-receipts.js cloudfunctions/updateInventory/operation-receipts.js

echo "   -> Updating audit-events.js..."
cp cloudfunctions/_shared/audit-events.js cloudfunctions/addMaterial/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/approveInventoryCorrectionRequest/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/batchAddInventory/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/editInventory/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/exportLabelData/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/importInventoryTemplate/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/updateInventory/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/adminUpdateUserStatus/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/approveMaterialRequest/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/manageMaterial/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/manageProductCodePrefix/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/manageTestMaterialIdentity/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/manageProjectCode/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/manageSubcategory/audit-events.js
cp cloudfunctions/_shared/audit-events.js cloudfunctions/addWarehouseZone/audit-events.js

echo "   -> Updating preprint-jobs.js..."
cp cloudfunctions/_shared/preprint-jobs.js cloudfunctions/exportLabelData/preprint-jobs.js
cp cloudfunctions/_shared/preprint-jobs.js cloudfunctions/addMaterial/preprint-jobs.js
cp cloudfunctions/_shared/preprint-jobs.js cloudfunctions/batchAddInventory/preprint-jobs.js
cp cloudfunctions/_shared/preprint-jobs.js cloudfunctions/importInventoryTemplate/preprint-jobs.js

echo "   -> Updating material-map.js and export-order.js..."
cp cloudfunctions/_shared/material-map.js cloudfunctions/getInventoryGrouped/material-map.js
cp cloudfunctions/_shared/export-order.js cloudfunctions/exportData/export-order.js
cp cloudfunctions/_shared/export-report.js cloudfunctions/exportData/export-report.js

echo "   -> Updating material-subcategories.js..."
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/manageSubcategory/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/manageMaterial/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/approveMaterialRequest/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/addMaterialRequest/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/getInventoryGrouped/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/exportData/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/exportMaterialTemplate/material-subcategories.js
cp cloudfunctions/_shared/material-subcategories.js cloudfunctions/getApprovalCenterData/material-subcategories.js

echo "   -> Updating material-units.js..."
cp cloudfunctions/_shared/material-units.js cloudfunctions/manageMaterial/material-units.js
# INTENTIONAL_STRICT_MATERIAL_UNIT_HELPERS:
# addMaterialRequest and approveMaterialRequest keep local strict material-units.js
# variants so requested default_unit must be explicitly selected instead of
# silently falling back to category defaults.

echo "   -> Updating product-code.js..."
cp cloudfunctions/_shared/product-code.js cloudfunctions/manageMaterial/product-code.js
cp cloudfunctions/_shared/product-code.js cloudfunctions/approveMaterialRequest/product-code.js

echo "   -> Updating product-code-prefixes.js..."
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/manageProductCodePrefix/product-code-prefixes.js
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/manageMaterial/product-code-prefixes.js
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/approveMaterialRequest/product-code-prefixes.js
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/exportMaterialTemplate/product-code-prefixes.js
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/exportInventoryTemplate/product-code-prefixes.js
cp cloudfunctions/_shared/product-code-prefixes.js cloudfunctions/importInventoryTemplate/product-code-prefixes.js

echo "   -> Updating search.js..."
cp cloudfunctions/_shared/search.js cloudfunctions/getInventoryGrouped/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/manageMaterial/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/getLogs/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/exportData/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/exportLabelData/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/searchInventory/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/manageTestMaterialIdentity/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/getProjectUsageReport/search.js
cp cloudfunctions/_shared/search.js cloudfunctions/exportProjectUsageReport/search.js

echo "   -> Updating log-search.js..."
cp cloudfunctions/_shared/log-search.js cloudfunctions/getLogs/log-search.js

echo "   -> Updating inventory-allocation.js..."
cp cloudfunctions/_shared/inventory-allocation.js cloudfunctions/getInventoryBatches/inventory-allocation.js
cp cloudfunctions/_shared/inventory-allocation.js cloudfunctions/updateInventory/inventory-allocation.js

echo "   -> Updating material-template.js..."
cp cloudfunctions/_shared/material-template.js cloudfunctions/exportMaterialTemplate/material-template.js

echo "   -> Updating project-codes.js..."
cp cloudfunctions/_shared/project-codes.js cloudfunctions/manageProjectCode/project-codes.js

echo "   -> Updating import-batch-results.js..."
cp cloudfunctions/_shared/import-batch-results.js cloudfunctions/manageMaterial/import-batch-results.js

echo "   -> Updating warehouse-zones.js..."
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/addWarehouseZone/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/addMaterial/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/batchAddInventory/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/editInventory/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/getInventoryGrouped/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/getInventoryBatches/warehouse-zones.js
cp cloudfunctions/_shared/warehouse-zones.js cloudfunctions/exportData/warehouse-zones.js

echo "   -> Updating batch-add.js..."
cp cloudfunctions/_shared/batch-add.js cloudfunctions/batchAddInventory/batch-add.js

echo "   -> Updating test-material.js..."
cp cloudfunctions/_shared/test-material.js cloudfunctions/addMaterial/test-material.js
cp cloudfunctions/_shared/test-material.js cloudfunctions/approveMaterialRequest/test-material.js
cp cloudfunctions/_shared/test-material.js cloudfunctions/batchAddInventory/test-material.js
cp cloudfunctions/_shared/test-material.js cloudfunctions/importInventoryTemplate/test-material.js
cp cloudfunctions/_shared/test-material.js cloudfunctions/manageMaterial/test-material.js

echo "   -> Updating test-material-identities.js..."
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/addMaterial/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/batchAddInventory/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/importInventoryTemplate/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/exportLabelData/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/updateInventory/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/getInventoryGrouped/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/getInventoryBatches/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/exportData/test-material-identities.js
cp cloudfunctions/_shared/test-material-identities.js cloudfunctions/manageTestMaterialIdentity/test-material-identities.js

echo "   -> Updating label-code.js..."
cp cloudfunctions/_shared/label-code.js cloudfunctions/addMaterial/label-code.js
cp cloudfunctions/_shared/label-code.js cloudfunctions/batchAddInventory/label-code.js

# 5. Sync Time + Stats Helpers
echo "   -> Updating cst-time.js and dashboard-stats.js..."
cp cloudfunctions/_shared/cst-time.js cloudfunctions/getDashboardStats/cst-time.js
cp cloudfunctions/_shared/cst-time.js cloudfunctions/getLogs/cst-time.js
cp cloudfunctions/_shared/cst-time.js cloudfunctions/exportData/cst-time.js
cp cloudfunctions/_shared/cst-time.js cloudfunctions/getProjectUsageReport/cst-time.js
cp cloudfunctions/_shared/cst-time.js cloudfunctions/exportProjectUsageReport/cst-time.js
cp cloudfunctions/_shared/dashboard-stats.js cloudfunctions/getDashboardStats/dashboard-stats.js

# 6. Sync to Frontend (Miniprogram)
echo "   -> Updating frontend config (miniprogram/utils)..."
cp cloudfunctions/_shared/alert-config.js miniprogram/utils/alert-config.js
cp cloudfunctions/_shared/search.js miniprogram/utils/search.js
cp cloudfunctions/_shared/log-search.js miniprogram/utils/log-search.js

echo "✅ Sync complete! Please deploy the updated functions."
