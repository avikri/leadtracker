import { Timestamp } from '@angular/fire/firestore';

/**
 * Multi-organisation data model.
 *
 * Two collections join an authenticated user to their tenant:
 *  - `organizations/{orgId}` — one doc per studio/business.
 *  - `users/{uid}` — doc id = Firebase Auth uid, points at exactly one organisation.
 *
 * Every lead carries `organizationId`, and the Firestore rules only allow access when it
 * matches the caller's `users/{uid}.organizationId`. There is deliberately NO role field
 * yet — every org member has full access. Keeping the join in its own doc (rather than a
 * custom claim or a field baked into the leads rules) leaves the door open for roles later.
 */

export interface Organization {
  /** Firestore doc id. */
  id: string;
  name: string;
  /**
   * URL-safe key identifying the org's asset folder. The brand logo is served by
   * convention from `assets/{slug}/logo.jpg` (see OrgService.logoUrl). Optional: orgs
   * without a slug (or without a logo file) fall back to the generic SVG mark.
   */
  slug?: string;
  createdAt: Timestamp;
}

/** The `users/{uid}` doc linking an authenticated user to their organisation. */
export interface AppUser {
  /** = doc id; also stored in-doc for query convenience. */
  uid: string;
  /** FK to `organizations`. A user belongs to exactly one org. */
  organizationId: string;
  email: string;
  displayName: string | null;
  createdAt: Timestamp;
}
