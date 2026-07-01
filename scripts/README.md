# Maintenance scripts (Admin SDK)

One-off scripts that talk to the **live** Firestore DB (`leadtracker-d1420`) with the
Firebase Admin SDK. They are intentionally **not** part of the Angular app — the app
never bundles `firebase-admin`.

> ⚠️ There is only one Firebase project. Dev and prod share this database, and Firestore
> rules block client-side deletes (`allow delete: if false`). The Admin SDK bypasses that,
> which is the only way to clean up afterwards. Handle with care.

## One-time setup

1. Get a service-account key: Firebase console → ⚙ Project settings → **Service accounts**
   → **Generate new private key**. Save it as `scripts/serviceAccountKey.json`
   (git-ignored), or set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
2. Install deps:
   ```
   cd scripts
   npm install
   ```

## Seed 50 fake leads

```
npm run seed:prod -- --dry-run   # preview the mix, writes nothing
npm run seed:prod                # write the 50 leads
```

Every seeded doc carries `seeded: true` and `seedTag: "fake-seed-2026-07-01"`, and its
`notes` start with `[SEED]` so they're recognisable in the UI. Phone numbers are in the
fictional NZ `555-01xx` range, so no real person is ever texted or called.

## Remove them again

```
npm run cleanup:seed             # shows how many match, deletes nothing
npm run cleanup:seed -- --confirm  # delete every seeded lead
```
