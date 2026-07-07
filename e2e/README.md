# End-to-end tests (Playwright + Firebase Emulators)

These tests drive the real Angular app against the **Firebase Emulator Suite** (Auth +
Firestore), so the actual security rules and org scoping are exercised — never the live
`leadtracker-d1420` project.

## How it fits together

| Piece | Role |
| --- | --- |
| `environment.test.ts` | `useEmulators=true`, `requireAuth=true`, `seedOnStartup=false`. Swapped in by the `test` build configuration (`angular.json`). |
| `app.config.ts` | Calls `connectAuthEmulator` / `connectFirestoreEmulator` when `useEmulators` is on. |
| `firebase.json` → `emulators` | Auth on **9099**, Firestore on **8080**, UI off. |
| `playwright.config.ts` | Starts two web servers (`npm run emulators`, `npm run start:test`), runs specs serially. |
| `e2e/support/emulator.ts` | Resets + seeds the emulators over their REST APIs (uses the Firestore `Bearer owner` token to bypass rules — needed because rules block client writes to `organizations`/`users`). |
| `e2e/support/fixtures.ts` | Per-test reset/seed + a UI `login` helper, plus `leadRow` / `queueCard` locators. |

The test project id is `demo-leadtracker-test`. The `demo-` prefix tells the emulators it is a
throwaway sandbox that needs no real credentials.

## Prerequisites

- **Node 18+** (the seeder uses global `fetch`).
- **Java JDK 11+** — the Firestore and Auth emulators require it. Check with `java -version`.
- Dependencies installed: `npm install` (adds `@playwright/test` + `firebase-tools`).
- Browser binaries: `npx playwright install chromium`.

## Running

```bash
npm run e2e            # headless, starts emulators + app automatically
npm run e2e:ui         # Playwright UI mode (watch/debug)
npm run e2e:headed     # headed browser
npm run e2e:report     # open the last HTML report
```

Playwright boots both servers for you. To run them by hand instead (e.g. to keep the emulators
warm while iterating):

```bash
npm run emulators      # terminal 1 — Auth + Firestore emulators
npm run start:test     # terminal 2 — ng serve on :4200 against the emulators
npm run e2e            # terminal 3 — reuses the already-running servers
```

## Test isolation

Every test calls `resetEmulators()` + `seedBaseline()` (via the `seed` fixture), wiping all
Firestore docs and Auth users and recreating the two tenants:

- **ORG_A** (`org-demo`) — user `frontdesk@demo.test` / `password123`
- **ORG_B** (`org-other`) — user `staff@other.test` / `password123`

Because the emulator is shared and reset between tests, the suite runs **serially**
(`workers: 1`). Seed a test's leads with `seed.seedLead(orgs.A, { … })` *before* signing in so
the app's live queue and one-shot table pick them up on load.

## CI

Set `CI=1`. The config then forbids `test.only`, retries once, and does not reuse servers. You
must still provision Java and run `npx playwright install --with-deps chromium` in the CI image.
