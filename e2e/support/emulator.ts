/**
 * Talks to the local Firebase Emulator Suite over its REST APIs — no Admin SDK dependency.
 *
 * Two things make this possible:
 *  - The Firestore emulator accepts `Authorization: Bearer owner`, which BYPASSES security
 *    rules. That's essential here: firestore.rules block ALL client writes to
 *    `organizations` and `users`, so seeding those tenants can only be done as "owner".
 *  - The Auth emulator exposes the normal Identity Toolkit signUp endpoint plus a
 *    `/emulator/v1/.../accounts` DELETE for wiping users between tests.
 *
 * Keep PROJECT_ID and the ports in sync with environment.test.ts, app.config.ts and the
 * `emulators` block in firebase.json.
 */

const PROJECT_ID = 'demo-leadtracker-test';
const API_KEY = 'fake-api-key';

const FIRESTORE_HOST = 'http://127.0.0.1:8080';
const AUTH_HOST = 'http://127.0.0.1:9099';
const FS_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// --- Fixed test tenants -------------------------------------------------------

/** Org whose leads the primary test user can see. */
export const ORG_A_ID = 'org-demo';
/** A DIFFERENT org, for the multi-tenancy isolation test. */
export const ORG_B_ID = 'org-other';

export const USER_A = { email: 'frontdesk@demo.test', password: 'password123' };
export const USER_B = { email: 'staff@other.test', password: 'password123' };

// --- Lifecycle ----------------------------------------------------------------

/** Wipe all Firestore documents and all Auth users for the test project. */
export async function resetEmulators(): Promise<void> {
  await Promise.all([
    fetch(`${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
      method: 'DELETE',
    }),
    fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' }),
  ]);
}

/**
 * Provision the two tenants: create both Auth users, both `organizations/{id}` docs, and the
 * `users/{uid}` join docs the Firestore rules gate on. Returns the created uids.
 */
export async function seedBaseline(): Promise<{ uidA: string; uidB: string }> {
  const uidA = await createAuthUser(USER_A.email, USER_A.password);
  const uidB = await createAuthUser(USER_B.email, USER_B.password);

  await setDoc(`organizations/${ORG_A_ID}`, { name: 'Demo Studio', createdAt: new Date() });
  await setDoc(`organizations/${ORG_B_ID}`, { name: 'Other Studio', createdAt: new Date() });

  await setDoc(`users/${uidA}`, {
    uid: uidA,
    organizationId: ORG_A_ID,
    email: USER_A.email,
    displayName: 'Front Desk A',
    createdAt: new Date(),
  });
  await setDoc(`users/${uidB}`, {
    uid: uidB,
    organizationId: ORG_B_ID,
    email: USER_B.email,
    displayName: 'Front Desk B',
    createdAt: new Date(),
  });

  return { uidA, uidB };
}

// --- Auth ---------------------------------------------------------------------

/** Create an Auth emulator user; returns its uid (localId). Retries while the emulator boots. */
export async function createAuthUser(email: string, password: string): Promise<string> {
  const res = await withRetry(() =>
    fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }),
  );
  const data = (await res.json()) as { localId?: string; error?: { message: string } };
  if (!data.localId) {
    throw new Error(`Auth emulator signUp failed for ${email}: ${JSON.stringify(data.error)}`);
  }
  return data.localId;
}

// --- Lead seeding -------------------------------------------------------------

export type LeadSource = 'new' | 'trial' | 'quiz' | 'promo' | 'deal99';
export type LeadStatus = 'New' | 'Contacted' | 'Responded' | 'Converted' | 'Lost';

export interface SeedLeadOverrides {
  source?: LeadSource;
  name?: string;
  phone?: string;
  email?: string | null;
  serviceUsed?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  createdAt?: Date;
  /** Trial: mark specific touchpoints done. */
  touchpointsDone?: Array<'firstServiceContact' | 'midTrialCheck' | 'finalTrialCall'>;
  promoName?: string | null;
  dealName?: string | null;
  /** Trial: Day 1 of the check-in schedule. Omit for a legacy undated trial (falls back to createdAt). */
  trialStartDate?: Date | null;
  trialEndDate?: Date | null;
  /** New client: backdatable business date. */
  leadDate?: Date | null;
}

/**
 * Write one fully-formed lead to `orgId`, mirroring the shape LeadService.createLead stamps
 * (status/timestamps/contactMethod/trial scaffold), so the app reads it exactly like a
 * manually-entered lead. Returns nothing — leads use auto ids.
 */
export async function seedLead(orgId: string, overrides: SeedLeadOverrides = {}): Promise<void> {
  const source = overrides.source ?? 'new';
  const done = new Set(overrides.touchpointsDone ?? []);
  const touchpoint = (key: 'firstServiceContact' | 'midTrialCheck' | 'finalTrialCall') => ({
    done: done.has(key),
    at: done.has(key) ? new Date() : null,
  });

  const lead: Record<string, unknown> = {
    organizationId: orgId,
    source,
    name: overrides.name ?? 'Test Lead',
    phone: overrides.phone ?? '021000000',
    email: overrides.email ?? null,
    serviceUsed: overrides.serviceUsed ?? null,
    notes: overrides.notes ?? null,

    status: overrides.status ?? 'New',
    contactMethod: source === 'quiz' ? 'call' : 'text',

    createdAt: overrides.createdAt ?? new Date(),
    contactedAt: null,
    lastContactAt: null,
    respondedAt: null,
    convertedAt: null,
    conversionOutcome: null,
    lostAt: null,
  };

  if (source === 'new') {
    lead['leadDate'] = overrides.leadDate ?? null;
  } else if (source === 'trial') {
    lead['trialStartDate'] = overrides.trialStartDate ?? null;
    lead['trialEndDate'] = overrides.trialEndDate ?? null;
    lead['experienceNotes'] = null;
    lead['touchpoints'] = {
      firstServiceContact: touchpoint('firstServiceContact'),
      midTrialCheck: touchpoint('midTrialCheck'),
      finalTrialCall: touchpoint('finalTrialCall'),
    };
  } else if (source === 'promo') {
    lead['promoName'] = overrides.promoName ?? null;
    lead['purchaseDate'] = null;
  } else if (source === 'deal99') {
    lead['dealName'] = overrides.dealName ?? null;
    lead['dealPurchaseDate'] = null;
  }

  await createDoc('leads', lead);
}

/** Count leads for an org (via a REST structured query) — handy for assertions. */
export async function countLeads(orgId: string): Promise<number> {
  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: 'POST',
    headers: authedJson(),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'leads' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'organizationId' },
            op: 'EQUAL',
            value: { stringValue: orgId },
          },
        },
      },
    }),
  });
  const rows = (await res.json()) as Array<{ document?: unknown }>;
  return rows.filter((r) => r.document).length;
}

// --- Firestore REST plumbing --------------------------------------------------

function authedJson(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
}

/** Create/overwrite a document at a known path (e.g. `organizations/org-demo`). */
async function setDoc(path: string, data: Record<string, unknown>): Promise<void> {
  const res = await withRetry(() =>
    fetch(`${FS_BASE}/${path}`, {
      method: 'PATCH',
      headers: authedJson(),
      body: JSON.stringify({ fields: toFields(data) }),
    }),
  );
  if (!res.ok) throw new Error(`setDoc ${path} failed: ${res.status} ${await res.text()}`);
}

/** Create a document with an auto-generated id in a collection (e.g. `leads`). */
async function createDoc(collectionPath: string, data: Record<string, unknown>): Promise<void> {
  const res = await withRetry(() =>
    fetch(`${FS_BASE}/${collectionPath}`, {
      method: 'POST',
      headers: authedJson(),
      body: JSON.stringify({ fields: toFields(data) }),
    }),
  );
  if (!res.ok) throw new Error(`createDoc ${collectionPath} failed: ${res.status} ${await res.text()}`);
}

/** Encode a plain JS object into Firestore REST `fields`. */
function toFields(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) fields[key] = toValue(value);
  return fields;
}

/** Encode a single JS value into a Firestore REST typed Value. */
function toValue(value: unknown): unknown {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
  }
  throw new Error(`Unsupported value for Firestore encoding: ${String(value)}`);
}

/** Retry a fetch a few times while the emulators finish booting (ECONNREFUSED early on). */
async function withRetry(fn: () => Promise<Response>, attempts = 20): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}
