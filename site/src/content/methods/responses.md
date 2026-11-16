# Responses, reviews and the waiting clock

A pull request's first response is the earliest comment or review on it by a person other than its author, and its first approval the earliest approving review by such a person. Both are timed from when the pull request became ready for review. Time to merge is timed from the opening, drafts included.

## What counts as a response

- **A response** is a comment in the pull request's conversation by another person that is not a bot command, or a review by another person whatever its verdict: approving, requesting changes, or only commenting. On GitHub a comment on a line of code belongs to a review, so it counts through that review.
- **Not a response**: a comment or review by a bot account, a [bot command](#commands) whoever makes it, and anything by the pull request's author, a reply in a review thread included.
- **An approval** is a review by another person that GitHub reports as approving. An approval later dismissed is reported as dismissed: it counts as a review that comments, and so as a response, but not as an approval.

## The waiting clock

The clock starts when the pull request is opened or, for one opened as a draft, when it is first marked ready for review. It does not stop if the pull request is later converted back to a draft: the time it then spends as a draft counts as waiting. A response or an approval made before then counts as made at that moment: no wait.

Whether a pull request was opened as a draft is read from its first "marked ready" or "converted to draft" event: a pull request first marked ready was opened as a draft, and one first converted to a draft was not. One with neither that is a draft now was opened as a draft and has never been ready, and one with neither that is not a draft now was opened ready.

A pull request never made ready has no response or approval time. It is left out of those measures and kept in the counts of pull requests opened, merged and closed. On the data as of {{asOf}}, {{prs.neverReady}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months had never been made ready.

## Finished pull requests, and those still open

For a pull request still open, the clock runs to {{asOf}}, the day the data runs to: see [Outcomes over time](#outcomes) for how such a pull request is counted. A pull request merged or closed before anyone responded has finished without a response, and a response after that does not count. The same holds for approvals.

Time from the first approval to merging or closing is a measure of its own, so that testing done after approval is not counted as waiting for review.
