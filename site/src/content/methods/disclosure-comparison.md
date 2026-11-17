# AI use disclosed against not disclosed

The AI-use section sets the pull requests that disclose AI use against those that do not, figure by figure, among the selected pull requests opened during the period. A pull request is in the disclosed group when it discloses in any of the [forms](#disclosure), and in the other group otherwise. Each figure says how many pull requests it rests on, where there are any.

## The figures

- **Lines changed** and **files changed**: the median and the 90th percentile of each group, each the value at or under which that share of the group lies.
- **First commit to opened**: the median and the 90th percentile read from the outcome curve of that span, over the pull requests whose first commit is known, as in [Commits and the three spans](#commits).
- **Merged within {{const.horizons}} days of opening**: for each of those numbers of days, of the group's pull requests opened at least that many days before the data was fetched, the share merged within that many days of opening. Only pull requests old enough to have a known outcome by then count, so the share and the count beside it are about the same pull requests, and younger ones are left out. With fewer than {{const.minFollowed}} such pull requests in a group, the cell says "too few to say".
- **With a bot review**: the share of the group with at least one review by a bot account, and the mean number a pull request had.

There is no median time to merge: the groups can differ in age, and a median far along a curve rests on a few of a group's oldest pull requests.

## What else sets the groups apart

This table sets the two groups side by side on things other than disclosure: the pull requests on the development branch, `master`, opened in the last {{const.recentMonths}} months, which are those the AI-use section compares over those months with every other filter as the report opens, as of {{asOf}}:

{{table.disclosureGroups}}

Over those months, with the same filters, the report also holds {{view.openedBefore}} pull requests opened before them, which the comparison leaves out: of all the pull requests it holds, {{view.notDisclosedInPeriod}} of those that do not disclose were opened in the period, against {{view.disclosedInPeriod}} of those that do.

The table shows how far apart the groups are in size, in age, in how much of each comes from a few people, and in the kind of change. Any of these can move a figure on its own, so a difference between the groups does not show an effect of using a tool. To compare like with like, narrow both groups with the same filters, by size or kind for example, and the comparison is redone over the pull requests that remain. And a pull request that does not disclose is not known to be tool-free: disclosure is voluntary.
