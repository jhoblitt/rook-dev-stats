// The Velocity section's charts, from the statistics library's results.

import type { AreaModel, BarSeries, BucketModel } from './charts';
import { AGE_COLOURS, COLOURS } from './colours';
import { AGE_BANDS, DISCLOSURES } from './filters';
import type { Backlog } from './stats/backlog';
import type { Weekly } from './stats/weekly';

const label = (id: (typeof DISCLOSURES)[number]['id']) => DISCLOSURES.find((d) => d.id === id)?.label as string;

/** The PRs opened per bucket, not disclosed stacked under disclosed, wherever they are drawn. */
export function openedBars(opened: Weekly<number>): BarSeries[] {
  return [
    { key: 'not-disclosed', label: label('not-disclosed'), color: COLOURS.notDisclosed, values: opened.values['not-disclosed'] ?? [] },
    { key: 'disclosed', label: label('disclosed'), color: COLOURS.disclosed, values: opened.values['disclosed'] ?? [] },
  ];
}

/** The PRs opened per bucket, with the PRs merged and closed unmerged as lines on the same axis. */
export function prsModel(opened: Weekly<number>, merged: Weekly<number>, closed: Weekly<number>): BucketModel {
  return {
    step: opened.step,
    buckets: opened.week,
    bars: openedBars(opened),
    stackLabel: 'opened',
    lines: [
      { key: 'merged', label: 'merged', color: COLOURS.reached, shape: 'circle', values: merged.values['merged'] ?? [] },
      {
        key: 'closed',
        label: 'closed unmerged',
        color: COLOURS.finishedWithout,
        shape: 'square',
        values: closed.values['closed'] ?? [],
      },
    ],
  };
}

/** The open backlog per bucket, by age band from the youngest up. */
export function backlogModel(b: Backlog): AreaModel {
  return {
    step: b.step,
    buckets: b.week,
    layers: AGE_BANDS.map((band) => ({ key: band.id, label: band.label, fill: AGE_COLOURS[band.id], values: b.bands[band.id] })),
    totalLabel: 'open',
  };
}
