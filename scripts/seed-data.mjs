// Generates 50 realistic-but-fake leads for O Studio Remuera, spread across all
// five sources and every status, with audit timestamps that stay internally consistent
// (contacted <= responded <= converted, all in the past). Numbers are in the safe
// fictional NZ 555-01xx range, so nobody real is ever contacted.
//
// Every doc carries `seeded: true` + `seedTag` so cleanup-seed.mjs can remove them.
// `organizationId` is NOT set here — seed-prod.mjs stamps it after resolving the org
// from the live `organizations` collection.

import { SEED_TAG } from './_admin.mjs';

const DAY = 86_400_000;

// --- Deterministic PRNG so a re-run produces the same 50 (mulberry32) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Aroha', 'Mereana', 'Sophie', 'Tane', 'Olivia', 'Hemi', 'Charlotte', 'Ngaire',
  'James', 'Ruby', 'Manaia', 'Wiremu', 'Anika', 'Daniel', 'Kahurangi', 'Ella',
  'Nikau', 'Isla', 'Rangi', 'Amelia', 'Tama', 'Grace', 'Ari', 'Maia', 'Leo',
  'Whetu', 'Harper', 'Koa', 'Frankie', 'Ihaka', 'Zoe', 'Manaaki', 'Talia',
  'Rico', 'Anahera', 'Ben', 'Kiri', 'Noah', 'Awhina', 'Liam', 'Moana', 'Jack',
  'Tui', 'Ethan', 'Piripi', 'Sienna', 'Marama', 'Cody', 'Reka', 'Hunter',
];
const LAST = [
  'Williams', 'Hayes', 'Walker', 'Wikaira', 'Chen', 'Ngata', 'Reti', 'Solomon',
  'Fonoti', 'Thompson', 'Brown', 'Katene', 'Sharma', "O'Connor", 'Patel', 'Baker',
  'Tipene', 'Murphy', 'Rewiti', 'Clark', 'Wong', 'Harrison', 'Kaur', 'Nguyen',
  'Pita', 'Robertson', 'Iosefa', 'Green', 'Mahuta', 'Singh', 'Taylor', 'Rangi',
];

const SERVICES = ['Reformer Pilates', 'Infrared Sauna', 'Group Fitness', 'Recovery Studio'];
const PROMOS = ['3-Week Floats', 'Summer Sauna Pass', 'New Year Reset', 'Bring-a-Friend', 'Winter Warm-Up'];
const DEALS = ['$99 Intro Pack', '$99 5-Class Deal', '$99 Starter Month', '$99 Reformer Intro'];

const CONVERSION = {
  new: ['Returned / re-booked', 'Bought a casual 10-pack', 'Signed up to weekly classes'],
  trial: ['Bought a membership — 12-month', 'Bought a membership — monthly', 'Upgraded to unlimited'],
  quiz: ['Booked a visit / came in', 'Booked an intro sauna session', 'Came in, booked a class'],
  promo: ['Bought a 10-class pack', 'Converted to monthly membership', 'Bought a sauna pack'],
  deal99: ['Bought a 10-class pack', 'Converted to monthly membership', 'Upgraded to unlimited'],
};

// How many of each source (sums to 50).
const SOURCE_PLAN = { new: 12, trial: 10, quiz: 10, promo: 9, deal99: 9 };

// Status mix per source — weights, not counts.
const STATUS_WEIGHTS = {
  new: [['New', 4], ['Contacted', 3], ['Responded', 2], ['Converted', 2], ['Lost', 1]],
  trial: [['New', 3], ['Contacted', 3], ['Responded', 2], ['Converted', 3], ['Lost', 1]],
  quiz: [['New', 4], ['Contacted', 3], ['Responded', 2], ['Converted', 1], ['Lost', 2]],
  promo: [['New', 3], ['Contacted', 3], ['Responded', 2], ['Converted', 3], ['Lost', 1]],
  deal99: [['New', 3], ['Contacted', 3], ['Responded', 2], ['Converted', 3], ['Lost', 1]],
};

// Age (days-ago range for createdAt) by status, so forward-dated audit stamps stay in the past.
const AGE_BY_STATUS = {
  New: [0.3, 4],
  Contacted: [1, 12],
  Responded: [3, 22],
  Converted: [8, 55],
  Lost: [10, 60],
};

export function buildSeedLeads(Timestamp) {
  const rand = rng(20260701);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = ([lo, hi]) => lo + rand() * (hi - lo);
  const ago = (days) => Timestamp.fromMillis(Date.now() - Math.round(days * DAY));

  const weightedStatus = (source) => {
    const rows = STATUS_WEIGHTS[source];
    const total = rows.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [status, w] of rows) {
      if ((r -= w) <= 0) return status;
    }
    return rows[0][0];
  };

  // Unique name pool (shuffle-ish via index walk so no repeats within 50).
  const names = [];
  const usedFirst = new Set();
  while (names.length < 50) {
    const f = pick(FIRST);
    const l = pick(LAST);
    const key = `${f} ${l}`;
    if (usedFirst.has(key)) continue;
    usedFirst.add(key);
    names.push({ f, l });
  }

  const emptyTouchpoints = () => ({
    firstServiceContact: { done: false, at: null },
    midTrialCheck: { done: false, at: null },
    finalTrialCall: { done: false, at: null },
  });

  const leads = [];
  let idx = 0;

  for (const [source, count] of Object.entries(SOURCE_PLAN)) {
    for (let i = 0; i < count; i++) {
      const { f, l } = names[idx++];
      const status = weightedStatus(source);
      const createdDays = between(AGE_BY_STATUS[status]);
      const contactMethod = source === 'quiz' ? 'call' : 'text';

      // Forward timeline (days-ago decreasing = later in time), clamped to the past.
      const contactedDays = Math.max(0.1, createdDays - between([0.5, 3]));
      const respondedDays = Math.max(0.1, contactedDays - between([0.5, 3]));
      const convertedDays = Math.max(0.05, respondedDays - between([0.5, 4]));
      const lostDays = Math.max(0.1, contactedDays - between([1, 5]));

      const has = {
        contacted: ['Contacted', 'Responded', 'Converted', 'Lost'].includes(status),
        responded: ['Responded', 'Converted'].includes(status),
        converted: status === 'Converted',
        lost: status === 'Lost',
      };

      const email =
        rand() < 0.12
          ? null
          : `${f.toLowerCase()}.${l.toLowerCase().replace(/[^a-z]/g, '')}@example.co.nz`;

      const lastContactDays = has.lost
        ? lostDays
        : has.responded
          ? respondedDays
          : has.contacted
            ? contactedDays
            : null;

      const doc = {
        seeded: true,
        seedTag: SEED_TAG,

        source,
        name: `${f} ${l}`,
        phone: `0${pick(['21', '22', '27'])} 555 0${String(100 + idx).padStart(3, '0')}`,
        email,
        serviceUsed: source === 'quiz' ? null : pick(SERVICES),
        notes: `[SEED] ${sourceNote(source, pick)}`,

        status,
        contactMethod,

        createdAt: ago(createdDays),
        contactedAt: has.contacted ? ago(contactedDays) : null,
        lastContactAt: lastContactDays === null ? null : ago(lastContactDays),
        respondedAt: has.responded ? ago(respondedDays) : null,
        convertedAt: has.converted ? ago(convertedDays) : null,
        conversionOutcome: has.converted ? pick(CONVERSION[source]) : null,
        lostAt: has.lost ? ago(lostDays) : null,
      };

      if (source === 'trial') {
        Object.assign(doc, buildTrial(status, ago, createdDays, contactedDays, respondedDays, convertedDays, emptyTouchpoints, rand));
      }
      if (source === 'promo') {
        doc.promoName = pick(PROMOS);
        doc.purchaseDate = ago(createdDays + between([1, 6]));
      }
      if (source === 'deal99') {
        doc.dealName = pick(DEALS);
        doc.dealPurchaseDate = ago(createdDays + between([1, 6]));
      }

      leads.push(doc);
    }
  }

  return leads;
}

function sourceNote(source, pick) {
  const notes = {
    new: ['First class on a casual pass.', 'Came in with a friend.', 'Asked about the timetable.', 'Walk-in, tried a class.'],
    trial: ['Signed up at the desk.', 'Keen on the classes + sauna combo.', 'Enjoying it, a bit sore.', 'Loved the community.'],
    quiz: ['Quiz: stress / recovery focus.', 'Quiz: strength goals. Left voicemail.', 'Quiz: flexibility, keen to come in.', 'Quiz lead, follow up by phone.'],
    promo: ['Campaign buyer, follow up to upsell a pack.', 'Summer pass purchaser.', 'Bought the floats campaign.', 'Promo buyer, upsell after campaign.'],
    deal99: ['Grabbed the $99 intro deal, upsell to a pack.', '$99 deal buyer, follow up on membership.', 'Bought the $99 intro, keen for more.', '$99 deal, upgrade after a few classes.'],
  };
  return pick(notes[source]);
}

function buildTrial(status, ago, createdDays, contactedDays, respondedDays, convertedDays, emptyTouchpoints, rand) {
  const tp = emptyTouchpoints();
  // Touchpoint progress tracks how far the lead has moved.
  const done = (days) => ({ done: true, at: ago(days) });

  if (status === 'Contacted') {
    tp.firstServiceContact = done(contactedDays);
  } else if (status === 'Responded') {
    tp.firstServiceContact = done(contactedDays);
    tp.midTrialCheck = done(respondedDays);
  } else if (status === 'Converted') {
    tp.firstServiceContact = done(contactedDays);
    tp.midTrialCheck = done(respondedDays);
    tp.finalTrialCall = done(convertedDays);
  } else if (status === 'Lost') {
    tp.firstServiceContact = done(contactedDays);
  }

  return {
    // Day 1 = entry day; end date is start + 7 (reference only, mirrors the form default).
    trialStartDate: ago(createdDays),
    trialEndDate: ago(createdDays - 7),
    experienceNotes: rand() < 0.5 ? 'Enjoying the sessions so far.' : 'Settling in, asked about class times.',
    touchpoints: tp,
  };
}
