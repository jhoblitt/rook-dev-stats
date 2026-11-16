// How much the PRs of a selection lean on bot commands.

import { type Dataset, PR_STATE } from '../data';
import { nearestRank } from './measures';

export interface CommandUse {
  /** The share of the PRs with at least one bot command; null with none selected. */
  share: number | null;
  /** The bot commands each merged PR took; null when none of the PRs merged. */
  merged: { mean: number; median: number; p90: number } | null;
}

/** Bot-command use over the rows, from the `bot_commands` column. */
export function commandUse(data: Dataset, rows: Uint32Array): CommandUse {
  const p = data.prs;
  const counts = new Int32Array(rows.length);
  let merged = 0;
  let withCommand = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const c = p.bot_commands[r] as number;
    if (c > 0) withCommand++;
    if (p.state[r] !== PR_STATE.merged) continue;
    counts[merged++] = c;
    sum += c;
  }
  const sorted = counts.subarray(0, merged).sort();
  return {
    share: rows.length === 0 ? null : withCommand / rows.length,
    merged: merged === 0 ? null : { mean: sum / merged, median: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9) },
  };
}
