# 实施计划

## Steps

1. Read applicable Trellis frontend/search/test-material contracts.
2. Add or extend shared frontend helper for remote paginated test-material identity selector loading.
3. Update label preprint selector:
   - open popup loads page 1
   - search input resets and remote-searches
   - popup scroll loads more
   - stale response guard
4. Update single stock-in selector with the same behavior.
5. Update batch stock-in selector with the same behavior.
6. Update test-material identity management list so it paginates beyond 100.
7. Update WXML/WXSS for scrollable popup lists, loading-more, and search-message copy.
8. Update tests:
   - static page contract tests for remote search and pagination
   - service/helper tests if needed
   - ensure old local-only filtering pattern is not used by these selectors
9. Run:
   - `git diff --check`
   - targeted tests
   - `npm test`
   - `npm run preflight:deploy`

## Review Gates

- No selector should rely on a fixed `pageSize: 100` one-shot load for current-code test identities.
- Stale response guards must exist for every changed selector.
- Product-code exact lookup remains unchanged.
- No new collection or index is introduced.
