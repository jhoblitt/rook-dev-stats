# How to check a number

Every figure on the site is computed in your browser from per-pull-request data, so a number can be traced to the pull requests behind it, and each of those to its pages on GitHub.

## From a figure to the pull requests

The table of pull requests lists every pull request open at some point in the period under the current filters, the Author and Reviewer filters among them. Choosing a week of a chart, or a month over a long period, narrows it to the pull requests opened during the part of that week or month that lies inside the period, so a first week that starts earlier leaves out those opened before. Choosing an age band of the backlog narrows it to the pull requests behind that band. Each row's number links to the pull request on GitHub.

The Timelines section draws the table's pull requests, up to its first {{const.laneCap}}, in its order, one per row. On the calendar, the axis never goes outside the period, and within it covers only the stretch those pull requests take up: it starts at the period's start or at the earliest opening among them, whichever is later, and ends at the period's end or at the latest end among them, a merge, a close or the last fetch while still open, whichever is earlier, with a few pixels more after that end, within the period, so its mark is drawn whole; a stretch shorter than an hour is widened to an hour. When the axis covers less than the period, the section says so and gives the days it covers. A row shows only what lies within the axis: the stretch before the opening, from a first commit made before it; the stretches open and closed before a reopening; each comment, review or bot command and each approval; and the merge, the close unmerged, or the last fetch while still open. A row whose pull request had its first commit or its opening before the axis starts has a mark at its left edge, and one whose merge, close or, while still open, last fetch came after the last moment the axis shows has a mark at its right edge. By days since opening, a row is the pull request's whole life, whatever the period, from its opening, on a log scale from an hour; what came before the opening is not drawn. In either, the counts of pull requests merged, closed unmerged and still open in its text alternative say what had become of them by the last fetch, whether or not the axis shows it.

Choosing a pull request, by its title in the table or by its dot, shows a link to it on GitHub, its kind and what decided it, links to the issues it closes, and, for a backport, a link to the pull request it backports. It also shows the pull request's timeline: its first commit, its opening, each comment, bot command and review, each lifecycle event, its last commit, and its final disposition or that it was still open at the last fetch, with the stretches it spent closed, the three spans, and the list of its commits.

## Where each mark links

The site stores no addresses. Each year's table file keeps what GitHub identifies each thing by: one entry for each event, that is each comment, review and lifecycle event, and the SHA of each commit, with its times, where the data has one. A mark's address is built from that and the pull request's number:

- a comment, a bot command or a bot account's comment: the comment, by its id, in the pull request's conversation;
- a review of any kind: the review, by its id;
- marked ready, converted to a draft, and closed: the event, by its id, in the conversation;
- merged and a force-push: the page of the commit it made, the merge commit or the commit pushed;
- the first and the last commit: that commit in the pull request's own view of its commits, or the whole of that view when none of the commits the data lists has that time; each commit in the list: that commit in the same view;
- opened, reopened, still open at the last fetch, and a final disposition GitHub recorded no event for: the pull request's page. GitHub gives a reopening no address of its own.

A mark whose address the data does not have is drawn without a link and says "address not recorded".

GitHub records a merge as a merge and a close at nearly the same moment. A close at or within 5 seconds after a merge is that record of the merge: the site's data leaves it out, and the timeline draws the merge alone. When GitHub reports a pull request merged but recorded no merge event for it, its last close is written as its merge, with no commit to link to.

An event can lack its address when GitHub returned none for it, or when its record was written before the data kept addresses. GitHub can also begin to return a force-push's commit later without moving the pull request's last-updated time, and neither a refresh nor a walk back to the start of the window fetches the pull request again, so its record stays without that commit until the pull request changes for another reason or the data is fetched afresh: see [How the pull requests are found](#counted-how-the-pull-requests-are-found). On the data as of {{asOf}}, {{refs.forcePushesWithoutCommit}} of the {{refs.forcePushes}} force-pushes in the last {{const.recentMonths}} months ({{refs.forcePushShareWithoutCommit}}) and {{refs.mergesWithoutCommit}} of the {{refs.merges}} merges in it have no commit to link to.

{{table.eventRefs}}

## Rebuilding the data

The records the site's data is built from are public, under `data/` in [the site's repository](https://github.com/jhoblitt/rook-dev-stats), and `rookstats rollup` rebuilds the site's data from them and the hand-edited tables without fetching anything.
