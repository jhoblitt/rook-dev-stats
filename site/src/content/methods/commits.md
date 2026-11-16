# Commits and the three spans

A pull request's first commit is the earliest author date among its commits, and its last commit the latest committer date. Three spans follow from them: first commit to opened, opened to last commit, and last commit to the final disposition, the merge or the close. All three are elapsed calendar time, not effort.

## Where the times come from

Git gives each commit two times. The author date is set when a change is first written and survives a rebase, an amend and a cherry-pick. The committer date is set again whenever a commit is rewritten, by any of those. So the first commit dates the oldest change in the pull request, and the last commit marks the last time its code changed for any reason, a rebase included.

The commits are the ones the pull request holds when it was last fetched. Commits that a force-push replaced are not among them; the force-push itself is kept as an event.

## The spans

- **First commit to opened** estimates how long the work went on before the pull request was opened. When the earliest author date is after the opening, a rewritten history has hidden when the work began, and the span is unknown rather than negative. On the data as of {{asOf}}, of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months, {{commits.firstUnknown}} have commits whose earliest author date is after the opening, and {{commits.none}} have no commits at all; neither has this span.
- **Opened to last commit** is measured only for pull requests that have finished, since an open pull request's last commit can still move. A last commit before the opening counts as no time.
- **Last commit to final disposition** is the wait after the code stopped changing. Like the other outcome measures it counts pull requests still open up to their age: see [Outcomes over time](#outcomes).

The final disposition is the last merge or close. A pull request reopened and closed again is finished at its last close. When GitHub reports a pull request finished but returns no merge or close event for it, the time GitHub last updated it stands in.

## Backports

A backport cherry-picks the original commits, which keep their author dates, so a backport's first commit is the original work's. For a backport, first commit to opened therefore measures how long after the original work the backport was opened, and the site titles that span "Original work to backport opened" in the Review section when, and only when, the Backport link filter is "links its original", so that every pull request selected links the one it backports, whatever the target, and in a selected pull request's timeline when, and only when, the pull request links the one it backports.
