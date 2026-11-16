# Outcomes over time

How long pull requests take is measured without dropping the ones that have not finished: a pull request still open counts for as long as it has been open, and no longer. Times are given as medians and percentiles read from outcome curves, never as an average over the finished pull requests alone, which would leave out the slowest.

## Outcome curves

An outcome curve is drawn over the pull requests opened during the period. For each number of days since a pull request was opened, or since it was ready for review for responses and approvals, it gives the share that had reached each outcome: merged, closed unmerged or still open; or responded, finished without a response, or still waiting. The outcomes compete, so a pull request closed unmerged can no longer merge. A pull request younger than a given number of days counts only up to its age, and the shares of the rest are estimated from those that were still at risk. This is the cumulative incidence (Aalen–Johansen) estimate.

## Medians and percentiles

The median is the day by which half the pull requests had reached the outcome, the 90th percentile the day by which nine in ten had, both read from the curve. Either can be missing, and the page says why:

- **not yet known**: so many pull requests are still waiting that the curve has not reached it yet, though it still can.
- **not reached**, as in "not reached: 70% merged": it can no longer be reached. Even if every pull request still waiting reached the outcome, the share would fall short, because too many have finished another way. The share given is the share that reached the outcome by the end of the curve.
- **no PRs opened** or **no PR to measure**: no pull request was opened in that week, or none of those opened can be measured, such as drafts never made ready, for the response time.

## Weeks

All times are UTC. A week is an ISO week, from Monday 00:00 UTC to the next; a period longer than 53 weeks is shown by calendar month instead. A week that runs past the start or the end of the period, or past the time the data runs to, is partial: only its part inside counts, and the charts mark it with how many of its days are covered. Pull requests opened in the most recent weeks have had the least time, so their medians are often not yet known.

## The backlog

The backlog of a week is the pull requests open at its end, or at the end of the period or the time the data runs to when either comes first: opened by then, and not between a close and a reopening. Each is placed in an age band by the days since it was opened.
