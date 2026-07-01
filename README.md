# Front Desk · Lead Tracker

A front-desk lead tracker for a single fitness/wellness studio (Auckland). Replaces a pile
of scattered Google Sheets with **one screen**: staff add every lead as it comes in, then work
a clean "to contact today" queue each morning.

**Stack:** Angular 19 (standalone components + signals, strict TypeScript) · Firebase Firestore
· AngularFire · Firebase Auth (stubbed).

This is a **baseline scaffold** built to be handed straight to Claude Code in an IDE. Architecture,
data model, and typing are the priority; visuals are intentionally low-fi.

---

## Run it

```bash
npm install
# 1. Create a Firebase project, enable Firestore + Email/Password auth.
# 2. Paste your web-app config into src/environments/environment.ts (the `firebase` block).
npm start            # → http://localhost:4200
```

On first run, with `seedOnStartup: true` (dev only), the app seeds ~14 sample NZ leads if the
`leads` collection is empty. Auth is a pass-through until you set `requireAuth: true`.

> **Firestore index:** the main query filters by `locationId` and orders by `createdAt`, which
> needs a composite index. It's declared in `firestore.indexes.json` (deploy with
> `firebase deploy --only firestore:indexes`), or just click the link Firestore prints in the
> console the first time the query runs.

---

## How it's wired

```
src/app/
  models/
    lead.model.ts          Lead interface + LeadSource / LeadStatus / ContactMethod unions, Touchpoints, LeadDraft
    lead.constants.ts      Labels, source→contactMethod logic, conversion prompts, status colours
  services/
    lead.service.ts        ★ The seam. All Firestore reads/writes. Reactive signals. Never deletes.
    auth.service.ts        Thin Firebase Auth wrapper (who's at the desk → audit fields)
  guards/
    auth.guard.ts          Pass-through until environment.requireAuth = true
  seed/
    seed-data.ts           ~14 sample leads (NZ names + mobile numbers), all sources & statuses
    seed.service.ts        Dev-only, seeds once if empty
  features/
    dashboard/             Top bar (+ Add lead, disabled Auto-import) + queue + table + modal
    queue/                 "To contact today" — status New, oldest first, method-correct action
    leads-table/           All leads, filter by source/status, inline pipeline actions, trial check-ins
    lead-modal/            Add/Edit one form. Source selector first; changing source is first-class.
```

**Components never touch Firestore.** They read `LeadService`'s signals (`leads`, `followUpQueue`)
and call its mutation methods. That's the one seam to extend.

### Data model (single `leads` collection)

- **Shared:** `id`, `locationId`, `source`, `name`, `phone`, `email`, `serviceUsed`, `notes`,
  `createdAt`, `enteredBy`.
- **Follow-up:** `status` (`New → Contacted → Responded → Converted | Lost`), `contactMethod`
  (`text` | `call`), and a timestamp for every transition (`contactedAt`, `respondedAt`,
  `convertedAt`, `lostAt`, `lastContactAt`) plus `conversionOutcome`, `contactedBy`.
- **Trial-only:** `trialStage` / `trialDay`, `experienceNotes`, and `touchpoints`
  (`firstServiceContact`, `midTrialCheck`, `finalTrialCall`), each `{ done, at, by }`.
- **Promo-only:** `promoName`, `purchaseDate`.

### Behaviours baked in (and where)

- **Contact method follows the source** — quiz leads are *called*, everyone else *texted*.
  Driven by `defaultContactMethod()` in `lead.constants.ts`; the queue/table action labels read
  "Mark called" / "Mark texted" off the lead. Nothing hard-codes "text".
- **"Converted" is source-specific** — one `Converted` status plus a free-text `conversionOutcome`
  and `convertedAt`, so it stays queryable. `CONVERSION_PROMPT` seeds the wording per source.
- **"Lost" is manual only** — there is no time-based auto-write-off. `LeadService.markLost()` is the
  only path, and it's behind a confirm in the table.
- **Nothing is ever deleted** — there is no delete method, and `firestore.rules` blocks deletes.
  Every state change is timestamped for future trend reporting.
- **Editing + changing source** — `lead-modal` reuses one form for add/edit; `LeadService.changeSource()`
  swaps the conditional field set, recomputes `contactMethod`, preserves shared + audit fields, and
  nulls stale source fields (it does NOT wipe trial touchpoints on an edit).
- **Trial touchpoints** — expand a trial row in the table to mark each check-in done (with audit);
  the queue card shows the next outstanding one.

### Multi-tenancy (invisible)

Every lead carries `locationId` and every query is scoped to it, but it's **hidden from the UI** —
no location picker. It's hard-coded to one studio (`environment.defaultLocationId`) so this can
become a multi-studio/franchise product with no schema retrofit. To go multi-studio, derive
`locationId` from the signed-in user instead of the environment (see `LeadService.locationId`).

---

## Phase 2+ seams (not built — hooks left in place)

- **Auto-import** from Mindbody (new clients & trials) and ScoreApp (quiz). The disabled
  "Auto-import (coming soon)" button is in the top bar. `LeadService.createLead()` is the single
  ingestion entry point an importer would call — marked `// TODO: Phase 2 ingestion`.
- **Sending the text/call from the tool** — out of scope (Phase 2/3).
- **Reporting / trend dashboards** — the timestamped, never-deleted model is designed to make this
  a read-only build later.

## Assumptions made (where the spec was open)

- Single-screen app: the top bar lives in the dashboard rather than a separate route.
- `Convert` and `Mark as Lost` confirmations go through the app-wide `DialogService` /
  `app-dialog` component (signal-driven, Promise-returning, focus-trapped) rather than the
  browser's native `confirm()` / `prompt()`.
- Template-driven form in the modal for readability; move to reactive forms when validation grows.
- Status colours, labels, and the conversion-prompt wording are guesses — all centralised in
  `lead.constants.ts`.
