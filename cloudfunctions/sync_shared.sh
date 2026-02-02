#!/bin/bash

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

# 2. Sync Response Helper
# (Only searchInventory uses it currently, but good to track)
echo "   -> Updating response.js..."
cp cloudfunctions/_shared/response.js cloudfunctions/searchInventory/response.js

# 3. Sync to Frontend (Miniprogram)
echo "   -> Updating frontend config (miniprogram/utils)..."
cp cloudfunctions/_shared/alert-config.js miniprogram/utils/alert-config.js

echo "✅ Sync complete! Please deploy the updated functions."
