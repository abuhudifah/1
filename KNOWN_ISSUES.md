# Known Issues & Limitations

> Last updated: 2026-06-11
> Status key: 🟢 Resolved | 🟡 Mitigated (workaround in place) | 🔴 Open

---

## 🟢 Resolved Issues

### KI-001 — Race Condition on account_number generation
**Symptom:** Two concurrent logins for the same new user could both try to INSERT an `account_number`, causing a `23505 unique_violation`.
**Fix (AuthService v5.1):** `_ensureUserAccountNumber()` now uses `.is('account_number', null)` on the UPDATE so it only writes when the column is NULL. On `23505` or `PGRST116` (no rows matched), it re-fetches the value already set by the concurrent process.
**File:** `services/AuthService.js`

### KI-002 — Supabase client naming collision
**Symptom:** Some files used the raw `window.supabase` object; others used `supabaseClient` (the wrapped singleton). Mixed usage caused "supabase is not defined" errors in some code paths.
**Fix (SupabaseClient.js v2.1):** All references unified to `supabaseClient`. Raw `window.supabase` no longer used anywhere.
**File:** `repository/SupabaseClient.js`

### KI-003 — Dashboard Realtime subscription memory leak
**Symptom:** On every tab navigation away from and back to Dashboard, a new Realtime channel was created without cleaning up the previous one.
**Fix:** `DashboardComponent.destroy()` method added; App.js calls it before unmounting the component.
**File:** `components/DashboardComponent.js`

### KI-004 — Session timer reset on every page refresh
**Symptom:** `checkSession()` called `saveSession()` which would reset the 8-hour timer, effectively making the session immortal.
**Fix (helpers.js S8):** `saveSession()` reads the existing `sessionExpiresAt` from sessionStorage and preserves it. A new 8-hour timer is only set on fresh login.
**File:** `utils/helpers.js`

### KI-005 — Network errors deleting Quick Login data
**Symptom:** Any error inside `quickLogin()` catch block — including a `TypeError: Failed to fetch` — would record a failed Brute Force attempt and potentially clear localStorage Quick Login data.
**Fix:** Network errors (`TypeError`, `Failed to fetch`, `NetworkError`) are detected and return early without clearing localStorage or recording a BF attempt.
**File:** `services/AuthService.js`

### KI-006 — account_balances and system_settings CRUD failures
**Symptom:** `Repository.getById()` / `update()` / `delete()` used `id` as the primary key column universally. `account_balances` uses `account_id`; `system_settings` uses `key`.
**Fix (Repository.js FIX-4):** `TABLE_PRIMARY_KEYS` map defines per-table PK columns. All CRUD operations accept an optional `pkColumn` override.
**File:** `repository/Repository.js`

---

## 🟡 Mitigated Issues (Workarounds in Place)

### KI-007 — No TypeScript — runtime type errors possible
**Description:** The project is pure Vanilla JavaScript. Missing type annotations means runtime errors on unexpected data shapes won't be caught at compile time.
**Mitigation:** The Result Pattern (`ok/err/isOk`) is used consistently. All external data (Supabase responses, user input) is validated at boundaries. `formatErrorMessage()` converts unexpected errors to safe user-facing messages.
**Planned Fix:** Phase 7 — ESLint with type-checking rules (JSDoc + `@ts-check`).

### KI-008 — Dexie schema migrations not handled for existing users
**Description:** If a user has Dexie version 1 data and the app upgrades to version 2 (which adds `offline_sessions`), Dexie's built-in upgrade handler runs automatically. However, there is no data migration logic for existing `offline_sessions`-like data that may have been stored in non-standard ways.
**Mitigation:** Version 2 only adds a new table; no existing tables are modified. Dexie handles additive upgrades gracefully.
**Risk Level:** Low — additive schema changes only.

### KI-009 — PrintService relies on Web Share API (not universally supported)
**Description:** `PrintService.shareAsText()` and `sharePDF()` use `navigator.share`. This is not available in desktop browsers (Chrome/Firefox on Windows/Linux) and some mobile browsers.
**Mitigation:** A fallback to `navigator.clipboard.writeText()` is implemented. If clipboard also fails, a toast prompts the user to copy manually.
**File:** `services/PrintService.js`

### KI-010 — Keyboard shortcut Ctrl+F conflicts with browser's native Find
**Description:** `Ctrl+F` is intercepted via `e.preventDefault()` to focus the in-app search field. However, this overrides the browser's built-in page search, which may surprise users who want native Find.
**Mitigation:** The shortcut only fires if a search input exists in the current tab's content (`#app-content input[type="search"]`). If none is found, the event is not prevented.
**Workaround:** Users can use `Ctrl+G` for browser Find-in-page instead, or click the address bar and use the browser menu.

### KI-011 — IdleTimer warning fires once but logout requires full timeout
**Description:** `IdleTimer` shows a warning 60 seconds before logout. However, if the user dismisses the warning by interacting with the page, the timer does not visually confirm it has been reset (no toast or indicator).
**Mitigation:** Any user interaction (mousemove, keydown, touchstart, scroll) resets the timer silently. The warning disappears automatically.
**Planned Fix:** Phase 8 — Add a subtle "session renewed" toast on reset.

---

## 🔴 Open Issues

### KI-012 — No offline support for binary file uploads (logos, attachments)
**Description:** The app supports uploading a company logo via Supabase Storage. If the user is offline when they change their logo, the upload will fail silently (no queue, no retry).
**Impact:** Logo changes are lost when offline.
**Workaround:** Advise users to change logos only when online.
**Planned Fix:** Phase 8 — Queue binary uploads in IndexedDB (as base64) for retry.

### KI-013 — Realtime notifications not delivered in Offline mode
**Description:** Supabase Realtime subscriptions in `DashboardComponent` and `NotificationsComponent` are dropped when the device goes offline. New notifications created by other users are not received until the next manual page load or tab switch.
**Impact:** Missed real-time updates in low-connectivity environments.
**Workaround:** Pull-to-refresh or `F5` keyboard shortcut triggers a fresh data load.
**Planned Fix:** Phase 8 — Background Sync + Push Notifications via Service Worker.

### KI-014 — No automatic conflict resolution UI
**Description:** When `SyncEngine` detects a conflict (local vs. server `updated_at` mismatch), it stores the conflict in `sync_conflicts` (Dexie) but there is no UI to let the user review and resolve conflicts manually.
**Impact:** Conflicts accumulate silently. The engine retries the operation, which may result in the local version overwriting the server version (or vice versa, depending on the resolution strategy).
**Workaround:** Admins can view conflicts by querying `db.sync_conflicts.toArray()` in the browser console.
**Planned Fix:** Phase 6 — Add a conflicts triage panel in the Settings tab.

### KI-015 — expr-eval library — no sandbox for deeply nested expressions
**Description:** The Quick Login equation evaluator uses `expr-eval` (v2.0.2), which evaluates mathematical expressions safely (no `eval()`). However, very complex or deeply nested expressions (e.g., 1000+ characters) are not rate-limited and could cause micro-freezes in the UI thread.
**Impact:** Cosmetic only — no security risk (expr-eval does not allow function calls or variable assignment).
**Workaround:** The UI limits the equation input field to practical length; no user has reported freezes.
**Planned Fix:** Add a length check (max 200 characters) and a 100ms timeout on evaluation.

### KI-016 — account_number format not validated on import
**Description:** `account_number` values are generated by `AuthService.generateAccountNumber()` following the pattern `[ROLE_PREFIX][RANDOM_6_DIGITS]`. However, if a user is created directly in Supabase (bypassing the app), the `account_number` may be NULL or in a wrong format.
**Impact:** Dashboard KPI calculations may produce NaN or missing values for those users.
**Workaround:** `AuthService._ensureUserAccountNumber()` runs on every login and backfills missing account numbers.
**Planned Fix:** Add a Supabase trigger to auto-generate `account_number` on INSERT into `users`.

---

## Intentional Design Decisions (Not Bugs)

### D-001 — Empty catch blocks in localStorage/sessionStorage access
Several `catch {}` blocks are intentionally empty (not `catch (e)`) in places where storage access fails due to browser policy (e.g., private browsing, storage quota exceeded). The failure is non-fatal: the feature simply doesn't persist.
**Files:** `utils/QuickLoginBanner.js`, `components/LoginComponent.js` (localStorage fallbacks)

### D-002 — BNK_ accounts never appear in accounting ledger
Bank account IDs are stored in `transactions.bank_account_id` as metadata only. The double-entry accounting system uses special unified accounts (`DEBTOR_SETTLEMENT`, `EXP_GENERAL`) for ledger entries instead of per-bank accounts. This is an intentional simplification of the chart of accounts.
**File:** `services/AccountingService.js`

### D-003 — 8-hour session is absolute, not sliding
The session expiry timer starts at login and is NOT reset by activity. This is intentional for security: even a continuously-active admin session expires after 8 hours and requires re-authentication.
**File:** `utils/helpers.js` (saveSession), `services/AuthService.js` (checkSession)

### D-004 — Ctrl+O triggers manual sync (not offline toggle)
The keyboard shortcut spec originally described `Ctrl+O` as "toggle offline mode." True offline toggling would require disconnecting the Supabase client, which risks data corruption if done mid-operation. Instead, `Ctrl+O` triggers `_handleManualSync()`, which is the safe and useful equivalent.
**File:** `App.js` (initKeyboardShortcuts)
