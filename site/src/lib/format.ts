// How the page writes its figures: counts as integers, shares as
// percentages, durations in days or, under two days, in hours.

import { dayOf } from './filters';
import type { Step } from './stats/buckets';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** One decimal, without a trailing `.0`. */
function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

export function formatCount(n: number): string {
  return integer.format(n);
}

/** A mean of counts, which is not a whole number. */
export function formatMean(n: number): string {
  return oneDecimal(n);
}

/** A share in [0, 1] as a percentage: whole from 10% up, one decimal below. */
export function formatShare(share: number): string {
  const pct = share * 100;
  return `${pct >= 10 ? integer.format(pct) : oneDecimal(pct)}%`;
}

export function formatDays(days: number): string {
  if (days < 2) {
    const hours = days * 24;
    if (hours === 0) return '0 hours';
    if (hours < 1) return 'under 1 hour';
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${days < 10 ? oneDecimal(days) : integer.format(days)} days`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A bucket's short name, for an axis: `18 May` or `Jan 2026`. */
export function bucketTick(start: number, step: Step): string {
  const d = new Date(start * 1000);
  const month = MONTHS[d.getUTCMonth()] as string;
  return step === 'week' ? `${d.getUTCDate()} ${month}` : `${month} ${d.getUTCFullYear()}`;
}

/** A bucket's full name: `week of 2026-05-18` or `June 2026`. */
export function bucketName(start: number, step: Step): string {
  if (step === 'week') return `week of ${dayOf(start)}`;
  const d = new Date(start * 1000);
  return `${MONTH_NAMES[d.getUTCMonth()] as string} ${d.getUTCFullYear()}`;
}

/**
 * A bucket as a sentence names it after a preposition: "in the week of
 * 2026-05-18", but "in June 2026".
 */
export function bucketPhrase(start: number, step: Step): string {
  const name = bucketName(start, step);
  return step === 'week' ? `the ${name}` : name;
}
