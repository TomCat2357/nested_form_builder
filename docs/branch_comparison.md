# Branch comparison: claude/search-results-width-scroll-0137aT5zWTt5FNrYPYccvRcf vs. claude/gdrive-form-storage-019TJBTZm2rKUMmvRznQZZ5N

## Branch heads and relationship
- `claude/search-results-width-scroll-0137aT5zWTt5FNrYPYccvRcf` points to commit `a955564`, which introduces a configurable max width for search results tables and enables horizontal scrolling when the table overflows.
- `claude/gdrive-form-storage-019TJBTZm2rKUMmvRznQZZ5N` points to commit `90c20b6`, which builds on top of `a955564` (the merge base is `a955564`). This means the gdrive branch already contains the search-results changes.

## Summary of search-results branch changes
- Adds a `searchTableMaxWidth` setting to the builder settings schema so administrators can cap the rendered table width.
- Updates the search page to apply the configurable width and allow horizontal scrolling when the table exceeds that width.
- Keeps the rest of the application identical to `main` at the time of branching.

## Summary of gdrive-form-storage branch changes (relative to search-results branch)
- Reworks form persistence to target Google Drive via Apps Script: introduces `gas/forms.gs`, cleans up storage utilities, and aligns form metadata with `settings.formTitle`.
- Switches client-side GAS communication to call `google.script.run` directly rather than relying on a configurable `gasUrl`, simplifying deploy and removing the import conflict dialog.
- Streamlines import/export flows by dropping the form `id` on export and reducing merge prompts during import.
- Restructures scripts by moving bundling scripts under `gas/scripts/`, deleting the MCP Playwright helpers, and adding new Playwright tests (e.g., `tests/test-new-form-question-add.js`).
- Adds `.local/` to `.gitignore` and refreshes deployment metadata such as `deploy.sh` and `gas/appsscript.json`.

## Key diff statistics between the two heads
- Files changed: 25
- Insertions: 1,405
- Deletions: 634
- Major touchpoints include `builder/src/app/state/dataStore.js`, `builder/src/services/gasClient.js`, new GAS source under `gas/`, and rehomed scripts/tests.
