# Offline-ready ExecPlan for Nested Form Builder

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

No PLANS.md file is currently checked into this repository; this document must nonetheless follow the ExecPlan requirements described in the provided PLANS.md guidance and remain self-contained.

## Purpose / Big Picture

Enable administrators and respondents to keep working with nested forms even when Google Apps Script is temporarily unreachable. After completing this plan, a user can open the app, see cached forms and entries with a clear offline banner, retry syncing when connectivity returns, and trust that caches stay coherent without silent data loss. The change is observable by toggling network reachability or forcing `google.script.run` to be absent: the UI should fall back to cached data, display offline status, and resync successfully when connectivity is restored.

## Progress

- [x] (2026-01-02 02:28:49Z) Reviewed repository structure, data/cache layers, and GAS endpoints to understand current intent.
- [ ] Describe current startup/cache flows in AppDataProvider and dataStore with examples of cache age thresholds and failure modes.
- [ ] Design and document offline/limited-mode UX (banner, disabled actions, retry affordance) spanning AppLayout and page-level components.
- [ ] Implement data-layer resilience for forms and entries (cache-first when GAS unavailable, explicit statuses, guarded mutations).
- [ ] Add validation steps, tests, and docs updates; capture retrospective.

## Surprises & Discoveries

- AppDataProvider already seeds UI from IndexedDB via `formsCache`, but any subsequent refresh throws if `hasScriptRun()` is false, so offline use quickly breaks despite cached data being available.
- Record access flows (list/get) rely on GAS even when caches have fresh data; background refresh triggers can silently fail without notifying the UI, leaving users unaware that data is stale.

## Decision Log

- Decision: Focus on offline-read resiliency before broader feature work so users retain access to cached forms/entries during outages.
  Rationale: Current data layer exits early when `google.script.run` is missing, negating the IndexedDB caches already present; addressing this first unlocks tangible user value and de-risks later enhancements.
  Date/Author: 2026-01-02 / assistant

## Outcomes & Retrospective

To be written after implementing and validating offline/limited-mode behavior.

## Context and Orientation

The React SPA under `builder/` loads global form state via `builder/src/app/state/AppDataProvider.jsx`, which seeds from IndexedDB (`builder/src/app/state/formsCache.js`) and then refreshes from GAS through `builder/src/app/state/dataStore.js`. dataStore wraps `builder/src/services/gasClient.js`, which depends on `google.script.run` injected by GAS (`gas/Code.gs` doGet/doPost) for all reads and writes. Entry caching lives in `builder/src/app/state/recordsCache.js` with binary-search-friendly ordering, while cache age decisions come from `builder/src/app/state/cachePolicy.js`. Pages like `builder/src/pages/MainPage.jsx` render form lists from the provider, and layout components such as `builder/src/app/components/AppLayout.jsx` render global chrome without awareness of connectivity. GAS endpoints in `gas/Code.gs` expose form management (list/get/save/archive) and record CRUD against Google Sheets.

## Plan of Work

Begin by documenting current cache and sync rules so the plan remains self-contained. Introduce an explicit offline/limited mode that reuses cached forms and entries, surfaces status in the UI, and constrains mutating operations until connectivity returns. Finally, validate with local runs that simulate missing `google.script.run` and real GAS connectivity.

Explain the edits concretely: add connectivity status tracking to AppDataProvider (covering cache state, last sync, and reasons for falling back), extend dataStore to return cached results when GAS is unavailable (while tagging responses with source metadata), and surface a global offline banner plus retry controls in AppLayout and affected pages (MainPage, SearchPage, Admin pages). Guard mutations (create/update/archive/delete forms and records) so they present user-facing toasts/dialogs in limited mode rather than throwing. Update docs to describe offline expectations and cache lifetimes.

## Concrete Steps

1) Document baseline behavior
    - Working directory: repository root.
    - Map current cache age thresholds and refresh triggers in `builder/src/app/state/cachePolicy.js`, `AppDataProvider.jsx`, and `dataStore.js` (forms/entries). Summarize in this plan to keep it self-contained.

2) Add connectivity/status model in AppDataProvider
    - Introduce state for `connectivityStatus` (online/offline/degraded), `lastSyncResult`, and `source` (cache/gas) alongside existing `forms` and `loadFailures`.
    - Wrap `dataStore.listForms` to catch `hasScriptRun` failures and return cached forms with a `source: "cache"` flag, skipping sync when only cache is available. Record the fallback reason so UI can explain limitations.
    - Ensure background refresh timers respect limited mode and reschedule retries with jitter to avoid tight loops when offline.

3) Propagate offline/limited UI affordances
    - Add a top-level banner in `builder/src/app/components/AppLayout.jsx` showing offline/degraded status, last sync time, and a "再読み込み" button that calls `refreshForms` with a force flag. Keep styling consistent with existing light card aesthetic.
    - In pages that initiate mutations (AdminDashboardPage, AdminFormEditorPage, FormPage submission/search flows), block actions when offline and show a dialog/toast explaining that GAS is unreachable; allow read-only previewing from cache where possible.
    - Provide an entry-level note in SearchPage when search results come from cache and may be stale.

4) Harden record access fallbacks
    - Extend `dataStore.getEntry` and `listEntries` to return cached entries when GAS is unavailable or `hasScriptRun` is false, emitting structured status (e.g., `{ source: "cache", staleMs }`). Skip cache invalidation when operating offline to avoid dropping data.
    - Update `builder/src/app/state/recordsCache.js` consumers to respect source metadata and avoid assuming GAS freshness in UI rendering.

5) Validation and docs
    - Add a developer note to README (or new `docs/offline-mode.md`) describing offline/limited mode, cache retention, and how to simulate offline by loading the built app without GAS (no `google.script.run`) or by temporarily overriding `window.google` in dev tools.
    - Validate via local preview: run `npm run builder:dev`, open the app, and in browser devtools set `window.google = undefined` before navigation to confirm cache-first rendering and offline banner; restore `window.google = { script: { run: { ...mock } } }` or deploy to GAS to verify resync.
    - If available, add a lightweight unit or integration test around cache fallbacks (e.g., injecting a mock gasClient) to assert that offline mode serves cache and exposes statuses.

## Validation and Acceptance

Acceptance hinges on observable behavior:
- Starting `npm run builder:dev` with cached forms present and `google.script.run` absent should load the MainPage from cache, show an offline banner, and avoid crashes or infinite spinners.
- Triggering "再読み込み" after restoring `google.script.run` (or deploying to GAS) should refresh forms from GAS, clear offline status, and update timestamps without data loss.
- Attempting to create/archive/delete a form while offline should present a clear modal/toast explaining the limitation and should not mutate cache state; the same action should succeed after connectivity returns.
- Fetching entries in SearchPage or FormPage should deliver cached results when offline and automatically reconcile with GAS on the next successful sync.

## Idempotence and Recovery

The plan keeps edits additive and retries safe: cache reads are read-only; offline retries back off rather than looping; commands like `npm run builder:dev` and `npm run builder:build` can be rerun without side effects. When a sync partially applies, rerunning the refresh with connectivity restores consistency. Avoid editing `dist/` artifacts (regenerated by builds) to keep rollbacks simple.

## Artifacts and Notes

Capture short transcripts showing offline banner appearance, cache-source logs in the console, and successful resync output. Store any new documentation under `docs/` alongside existing manuals.

## Interfaces and Dependencies

Prescribe stable shapes to keep the implementation aligned:
- In `builder/src/app/state/AppDataProvider.jsx`, expose `connectivityStatus`, `lastSyncedAt`, `lastSyncResult`, `dataSource` (`"gas" | "cache"`), and `refreshForms({ forceSync?: boolean })` in context consumers.
- In `builder/src/app/state/dataStore.js`, allow `listForms`/`getForm` to return `{ forms, loadFailures, source: "gas" | "cache", reason?: string }`; allow `getEntry`/`listEntries` to return `{ entries, headerMatrix, source, staleMs }`.
- Keep gasClient API signatures unchanged for online paths; introduce injectable transport or guards for offline simulation without touching GAS.

---
Change note: Initial draft created on 2026-01-02 to capture the offline-read resiliency approach before implementation.
