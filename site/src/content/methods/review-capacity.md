# Review capacity against arrivals

The Review section's first chart sets the human review done each week against the pull requests that arrived that week. It has four panels, each on its own scale, over the selected pull requests and the period.

## The four panels

- **People giving reviews**: the distinct people who submitted a human review that week, approving, requesting changes or commenting, on any selected pull request. A conversation comment alone does not make someone one of them, though it counts in the Reviewers table of [the People tables](#people-tables).
- **PRs opened per person giving reviews**: the selected pull requests opened that week, divided by the people giving reviews. A week with no one giving reviews has no value, marked "no one giving reviews", rather than zero or infinity.
- **Human reviews per PR opened**: the human reviews done that week on any selected pull request, divided by the pull requests opened that week. A week with none opened has no value, marked "no PRs opened".
- **PRs waiting for a first response**, counted at the week's end: the selected pull requests open at that moment, out of draft, and with no first human response yet.

## Waiting for a first response

The moment is the end of the week, or the end of the period or the time the data runs to when either comes first. A pull request is out of draft at that moment when its latest "marked ready" or "converted to draft" event at or before then is a "marked ready", or, with neither, when it was opened ready. So a pull request never made ready never waits, and one put back into draft stops waiting until it is marked ready again. One closed without a response stops waiting while it is closed and waits again if it is reopened. Once its first human response has come it no longer waits. A response made before the pull request was first marked ready counts as made at that moment, so a pull request answered before it was first ready never waits.

## Weeks

Weeks are ISO weeks, as in [Outcomes over time](#outcomes), and a period longer than 53 weeks is shown by calendar month. A week cut short by the period or by the time the data runs to is marked as partial; in it each ratio divides two partial counts.

## What it cannot show

The chart compares flows in the same week, not one group of pull requests followed over time: a review done this week may be on a pull request opened months ago, and a pull request opened this week may be reviewed weeks later. A count of reviews says nothing of how thorough each was, and a person giving one review counts as much as one giving fifty. For how long pull requests wait, follow them over time in the outcome curves.
