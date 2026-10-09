/*
 * The sample workspace: the household the ratified design was drawn around,
 * with fictional names, and the systems that share its sky. Every date is a
 * lead time from the day the page is opened, so the dial is always true to
 * today. Nothing here is anyone's real home.
 */
import { addDays, constellationPosOf } from "./law.js";

export const today = new Date();
today.setHours(0, 0, 0, 0);

const SECTIONS = [
  { id: "home", name: "Home", icon: "home", accent: "sage" },
  { id: "vehicles", name: "Vehicles", icon: "vehicle", accent: "blue" },
  { id: "devices", name: "Devices", icon: "device", accent: "sand" },
  { id: "services", name: "Services", icon: "service", accent: "plum" },
];

let seq = 0;
function item(fields) {
  const id = fields.id ?? `i-${++seq}`;
  return {
    id,
    status: "active",
    kind: "service",
    recurrenceMonths: 12,
    costIsEstimate: true,
    reminderDays: [14],
    documents: [],
    provider: null,
    ...fields,
    dueDate: addDays(today, fields.days),
  };
}

export const households = {
  willow: {
    id: "willow",
    name: "Willow House",
    role: "owner",
    members: 4,
    sections: SECTIONS,
    pos: [0, 0],
    items: [
      item({ id: "i-gutter", title: "Gutter clearing", section: "home", days: -16, costMinor: 15000, reminderDays: [14, 3] }),
      item({ id: "i-mot", title: "Car MOT — Volvo V60", section: "vehicles", days: 16, costMinor: 5485, costIsEstimate: false, kind: "inspection", reminderDays: [21, 7],
        documents: [{ name: "MOT certificate 2025", meta: "added 12 Jun · 240 KB" }, { name: "Service history", meta: "added 12 Jun · 88 KB" }] }),
      item({ id: "i-boiler", title: "Boiler service", section: "home", days: 22, costMinor: 12000, provider: "Warm & Co." }),
      item({ id: "i-chimney", title: "Chimney sweep", section: "home", days: 61, costMinor: 9000 }),
      item({ id: "i-smoke", title: "Smoke alarm batteries", section: "devices", days: 122, costMinor: 1200, recurrenceMonths: 6, reminderDays: [7] }),
      item({ id: "i-svc", title: "Car full service", section: "vehicles", days: 161, costMinor: 30000, reminderDays: [21],
        documents: [{ name: "service-invoice-2026.pdf", meta: "added 12 Jun · 240 KB" }, { name: "service-checklist.pdf", meta: "added 12 Jun · 88 KB" }] }),
    ],
  },
  seaside: {
    id: "seaside", name: "Seaside cottage", role: "member", members: 3, sections: SECTIONS, pos: [-617, -305],
    items: [
      item({ title: "Septic tank emptying", section: "home", days: 27, costMinor: 21000 }),
      item({ title: "Holiday let insurance", section: "home", days: 140, costMinor: 62000, kind: "renewal", provider: "Harbour Mutual" }),
      item({ title: "Chimney sweep", section: "home", days: 210, costMinor: 9000 }),
    ],
  },
  narrow: {
    id: "narrow", name: "The narrowboat", role: "member", members: 2, sections: SECTIONS, pos: [-515, 393],
    items: [
      item({ title: "Boat safety certificate", section: "vehicles", days: 73, costMinor: 18000, kind: "inspection", recurrenceMonths: 48 }),
      item({ title: "Engine service", section: "vehicles", days: 188, costMinor: 24000 }),
    ],
  },
  grans: {
    id: "grans", name: "Gran's flat", role: "member", members: 2, sections: SECTIONS, pos: [722, -184],
    items: [
      item({ title: "Gas safety check", section: "home", days: 19, costMinor: 8500, kind: "inspection" }),
      item({ title: "Stairlift service", section: "devices", days: 96, costMinor: 15000 }),
    ],
  },
  mumdad: {
    id: "mumdad", name: "Mum & Dad's", role: "member", members: 2, sections: SECTIONS, pos: [452, 522],
    items: [
      item({ title: "Roof inspection", section: "home", days: 240, costMinor: 12000, kind: "inspection", recurrenceMonths: 24 }),
      item({ title: "Car insurance", section: "vehicles", days: 48, costMinor: 38000, kind: "renewal" }),
    ],
  },
};

/* The positions are the app's own transform for these ids where the design
   scattered them; constellationPosOf keeps any new system in the same law. */
for (const h of Object.values(households)) if (!h.pos) h.pos = constellationPosOf(h.id);

/* What a visit changes, written down for the next one — this browser only. */
const STATE_KEY = "orbit-site-state";
const STATE_VERSION = 1;
/* the local calendar date; toISOString gives the UTC one, yesterday east of Greenwich */
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function serialise() {
  return {
    v: STATE_VERSION,
    households: Object.fromEntries(Object.values(households).map((h) => [h.id, h.items.map((it) => ({ ...it, dueDate: ymd(it.dueDate), completedOn: it.completedOn ? ymd(it.completedOn) : undefined }))])),
    review: inbox.review.map((r) => r.id),
  };
}
export function hydrate(saved) {
  if (!saved || saved.v !== STATE_VERSION) return false;
  for (const [id, items] of Object.entries(saved.households ?? {})) {
    if (!households[id]) continue;
    households[id].items = items.map((it) => ({ ...it, dueDate: new Date(`${it.dueDate}T00:00:00`), completedOn: it.completedOn ? new Date(`${it.completedOn}T00:00:00`) : undefined }));
  }
  if (Array.isArray(saved.review)) inbox.review = pristineReview.filter((r) => saved.review.includes(r.id));
  return true;
}
export function persist() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(serialise())); } catch { /* this visit only */ }
}
export function recall() {
  try { const raw = localStorage.getItem(STATE_KEY); return raw ? hydrate(JSON.parse(raw)) : false; } catch { return false; }
}
export function forget() {
  try { localStorage.removeItem(STATE_KEY); localStorage.removeItem("orbit-pack"); sessionStorage.removeItem("orbit-site-arrived"); } catch { /* nothing kept */ }
}

/** The account: a fictional member, and their relay. */
export const account = {
  initials: "AR",
  name: "Ada Reid",
  relay: "ada-k7f2m@in.willow-house.orbit",
};

/** What the relay has caught. */
export const inbox = {
  filed: [
    { id: "r-mot", title: "Car MOT — Volvo V60", note: "free mot-reminder.pdf · filed against the item", when: "12 Jun" },
  ],
  review: [
    {
      id: "r-insurance",
      title: "Home insurance renewal",
      household: "willow",
      section: "home",
      provider: "Harbour Mutual",
      renewsInDays: 51,
      costMinor: 40000,
      kind: "renewal",
      source: "policy-schedule.pdf · 312 KB · scanned clean",
      readings: [
        ["renews", "in 51 days", true],
        ["cost", "~£400.00", false],
        ["provider", "Harbour Mutual", true],
      ],
      burnsInDays: 43,
    },
  ],
  reading: [
    { id: "r-new", title: "A message arrived 4 minutes ago", note: "Orbit is reading its document — it will appear for review when it's done" },
  ],
  failed: [
    { id: "r-large", title: "A message from 09 Aug", note: "too large · Its attachment was larger than Orbit can store. You can add the item yourself and attach the file from Documents." },
    { id: "r-unread", title: "A message from 06 Aug", note: "no readable document · It carried no document Orbit can read (PDFs work best). Nothing was kept." },
  ],
};
const pristineReview = inbox.review.slice();
/* the sample as shipped, taken before any visit's changes are recalled */
const pristineState = serialise();
export function pristine() { hydrate(pristineState); }
