# What is counted, and when

The data holds the pull requests of [ceph/ceph](https://github.com/ceph/ceph) that were open at some point in a window that starts on {{windowStart}} and runs to {{asOf}}, the day the last complete fetch from GitHub began. A pull request opened before the window is in it when it was still open in the window.

The report opens on the whole window, from {{windowStart}} to {{asOf}}, and a reader can choose a shorter period inside it. Besides the period's From and To dates, dragging across a chart drawn over the period sets the period to the weeks or months dragged over, and a double-click on such a chart widens the period to twice its length around its middle, within the window. The figures on this page are over the last {{const.recentMonths}} months of the window instead, so that the page loads only their data. On the data as of {{asOf}}, {{prs.active}} pull requests, on every branch, were open at some point in the last {{const.recentMonths}} months, {{periodStart}} to {{asOf}}: {{prs.openedInPeriod}} opened in them and {{prs.openedBeforePeriod}} before them.

## How the pull requests are found

Each fetch lists pull requests by the time GitHub last updated them: by default every one updated since a day before the previous fetch began, and then every one still open. A walk back to the start of the window, which is how the data was first built, lists every pull request open at any moment in the window: each is either still open, and so listed, or was closed after the window started, which updates it. A listed pull request is fetched again when GitHub's last-updated time has moved since it was last fetched, or when what was fetched before is kept in an older format; otherwise what was fetched before is kept. What was fetched is turned into the records again on every `cephstats extract`, and the records into the site's data, with the hand-edited tables, on every build, so a change to the rules can change a record or a figure without a new fetch.

This relies on GitHub's last-updated time, and one change is known not to move it. Once, every pull request the data then held was fetched afresh, into an empty cache, and compared with what a refresh had produced. Apart from pull requests that GitHub updated between the two fetches, the two differed in a single event: a force-push whose commit GitHub had not returned before and now did, on a pull request whose last-updated time had not moved. Neither a refresh nor a walk back to the start of the window fetches such a pull request again, since both keep what was fetched before at the same last-updated time. So the data can lag GitHub in a link of this kind until the pull request changes for another reason or the data is fetched afresh. No count, time or classification depends on that commit, only the link to it and this page's count of force-pushes with no commit to link to (see [How to check a number](#checking)). Whether other kinds of change also leave the time unmoved is not known: that comparison found none.

The data is refreshed by hand, not on a schedule, so it can be some weeks old; the date above says how old.

A pull request that finished before {{windowStart}} can be among the records too, when GitHub updated it after that day. No period on this site starts before {{windowStart}}, so none of them is counted.

## What a filter selects

- **Period**: every pull request open at some point in the period, that is, opened before the period ends and not finished before it starts. Counts by calendar week, such as merges, reviews, bot commands and the backlog, count what happened in each week of the period to those pull requests; over a period longer than 53 weeks they count by calendar month instead. Counts of pull requests opened, the outcome curves and the figures by week opened take only those opened during the period.
- **Target**: `main`, the development branch under either of its names, `main` or `master`; or every other branch together as "backports and other branches"; or all. See [Target, component and kind](#kind).
- **Branch**: keeps the pull requests on one base branch, as GitHub reports it at the last fetch, chosen from the branches the target holds, each offered with how many pull requests on it were open at some point in the period whatever the other filters; a change of target to one that does not hold the chosen branch sets the filter back to any branch.
- **Backport link**: "links its original" keeps the pull requests whose description says "backport of" followed by a link to a ceph/ceph pull request or its number, as [Target, component and kind](#kind) describes, and "no link" keeps the rest, which can still be backports, since the older releases' backports seldom carry that line.
- **Component** and **kind**: see [Target, component and kind](#kind). A pull request with two components is in both.
- **Size**: lines added plus lines deleted.
- **Author standing**: see [What the data cannot show](#limits).
- **AI use disclosure**: "AI use disclosed" is any of the forms in [Disclosure of AI use](#disclosure), and "AI use not disclosed" is none of them.
- **Exclude drafts**: leaves out the pull requests that are drafts now, not those that were drafts once.
- **Reopened**: keeps the pull requests reopened at least once.
- **Author**: keeps the pull requests a login opened, or those credited to a deleted account's name or to "(deleted, unknown)" ([Deleted accounts](#people-deleted-accounts)).
- **Reviewer**: keeps the pull requests a login reviewed or commented on during the period, other than their own: see [The People tables](#people-tables). Every comment and review by a deleted account counts for "(deleted, unknown)", so choosing a deleted account's name keeps none.
