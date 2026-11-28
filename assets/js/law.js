/*
 * The chart law, carried from orbit's web/src/lib/data/chart.js.
 *
 * The dial is an orbital calendar: today sits at 12 o'clock and each day of
 * lead time is one degree clockwise, so angle° = daysUntilDue − 90. Distance
 * grows linearly with time, radius = 62 + 0.242·days, bounded by the rim;
 * overdue bodies fall inward at 0.625/day, floored clear of the sun.
 */
import { tr, dateWords, caps, monthsCount, yearsCount, grouped } from "./lang.js";

export const DIAL_CENTRE = 190;
export const RIM = 166;
export const SUN_CLEARANCE = 24;
const DAY = 86400000;

export function hashId(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function dialPlacement(days) {
  const angle = (Math.max(-90, Math.min(days, 430)) - 90) * (Math.PI / 180);
  const radius = days >= 0
    ? Math.min(62 + 0.242 * days, RIM)
    : Math.max(SUN_CLEARANCE, 62 - 0.625 * -days);
  return {
    angle,
    radius,
    x: Math.round((DIAL_CENTRE + Math.cos(angle) * radius) * 10) / 10,
    y: Math.round((DIAL_CENTRE + Math.sin(angle) * radius) * 10) / 10,
  };
}

/** Bigger = costlier. Radius in dial units from minor units. */
export function bodySize(costMinor) {
  if (!costMinor) return 4;
  const pounds = Math.max(costMinor / 100, 1);
  return Math.min(8.5, Math.max(3.5, Math.round((0.8 + 1.09 * Math.log(pounds)) * 10) / 10));
}

/** The chart key's urgency bands. */
export function bandOf(days) {
  if (days === null || days === undefined) return "unscheduled";
  if (days < 0) return "overdue";
  if (days <= 30) return "due-soon";
  if (days <= 90) return "upcoming";
  return "ok";
}

/** An expiry past its date is never overdue: nothing is owed on a thing that has ended. */
export function bandOfKind(kind, days) {
  const band = bandOf(days);
  return kind === "expiry" && band === "overdue" ? "ended" : band;
}

export const PAINTS = { overdue: "ruby", "due-soon": "amber", upcoming: "sky", ok: "jade", unscheduled: "jade", ended: "ended" };
export const TONES = { overdue: "--overdue", "due-soon": "--warm", upcoming: "--upcoming", ok: "--ok", unscheduled: "--ok", ended: "--ink-faint" };

/** A household's absolute position in the shared map: bearing from one hash, distance from another. */
export function constellationPosOf(householdId) {
  const bearing = (hashId(householdId) / 0xffffffff) * Math.PI * 2;
  const distance = 640 + (hashId(`${householdId}/distance`) % 121);
  return [Math.round(Math.cos(bearing) * distance), Math.round(Math.sin(bearing) * distance)];
}

/** The mini planets a distant constellation shows: its three most pressing items. */
export function constellationPlanetsOf(items) {
  return items
    .filter((item) => item.status === "active")
    .slice()
    .sort((a, b) => a.days - b.days)
    .slice(0, 3)
    .map((item, index) => {
      const angle = ((hashId(item.id) % 120) + index * 120) * (Math.PI / 180);
      const distance = 18 + (hashId(`${item.id}/orbit`) % 13);
      const radius = 2 + ((hashId(`${item.id}/size`) % 9) / 10);
      return [Math.round(Math.cos(angle) * distance), Math.round(Math.sin(angle) * distance), radius, TONES[bandOf(item.days)]];
    });
}

/* ---- dates, in the app's own words -------------------------------------- */
/* the twelve months' labels in capitals, in the page's language, January first */
export const MONTHS = Array.from({ length: 12 }, (_, m) => caps(dateWords(new Date(2000, m, 1), "month")));

export function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
}
/* the countdown is a notation, written the same in every language */
export function tminus(days) {
  return days < 0 ? `T+${-days}d` : `T−${days}d`;
}
export const shortDate = (date) => dateWords(date, "short");
export const longDate = (date) => dateWords(date, "long");
export const monthName = (date) => dateWords(date, "monthName");
export function todayWords(date) {
  return tr("today-line", { weekday: caps(dateWords(date, "weekday")), date: caps(shortDate(date)) });
}
/* a repeat period as a whole catalogue phrase (one-off, every month, every year, every 6 months, every 2 years); the keys
   are, in order, those for no repeat, one month, one year and the one that takes the count */
function phrase(months, [none, month, year, count]) {
  if (!months) return tr(none);
  if (months === 12) return tr(year);
  if (months === 1) return tr(month);
  return tr(count, { count: months % 12 === 0 ? yearsCount(months / 12) : monthsCount(months) });
}
export const every = (months) => phrase(months, ["repeat-none", "repeat-month", "repeat-year", "repeat-every"]);
/* the same after "orbital period" in a row's line */
export const period = (months) => phrase(months, ["period-none", "period-month", "period-year", "period-every"]);
export function money(minor, estimate) {
  if (minor === null || minor === undefined) return "—";
  return `${estimate ? "~" : ""}£${grouped(minor / 100)}`;
}
