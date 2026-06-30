import { Timestamp } from '@angular/fire/firestore';

/** Small presentation helpers for Firestore Timestamps. UI-only, no domain logic. */

export function toDate(ts: Timestamp | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

/** e.g. "2 Jun" or "—". */
export function shortDate(ts: Timestamp | null | undefined): string {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

/** e.g. "2 Jun, 9:14 am". */
export function dateTime(ts: Timestamp | null | undefined): string {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Coarse relative label, e.g. "Just now", "3h ago", "2d ago". */
export function relative(ts: Timestamp | null | undefined): string {
  const d = toDate(ts);
  if (!d) return '—';
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
