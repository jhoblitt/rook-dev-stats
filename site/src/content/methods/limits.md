# What the data cannot show

The window starts on {{windowStart}}. A pull request opened before then is counted only when it was still open on or after that day. Its record then holds its comments, reviews and lifecycle events from before that day too, but counts of events take only those inside the period. The records can also hold one that finished before then, as [What is counted](#counted) says, but no period starts before that day, so it is never counted. So the site can show the state of the project since {{windowStart}} and how that state has moved, and not how it worked before. The report opens on the whole window, from {{windowStart}} to {{asOf}}, and shows a shorter period only when a reader chooses it.

## No comparison across years

The report gives no figure comparing the years before AI tools were common with the years since. It opens on the whole window, so its charts draw both, and a reader can narrow the period to either. But years differ in ways that have nothing to do with tools: in the project's size and who was active in it, in the bots and automation it ran, and in what GitHub itself recorded at the time (see [Older pull requests](#limits-older-pull-requests)). The report also counts AI use only where a pull request discloses it (see [Disclosure of AI use](#disclosure)), so a year with no disclosures is not a year without AI use. A difference between years is therefore not, on its own, an effect of a tool.

## Author standing

An author's standing is how many pull requests they had opened in ceph/ceph before the one counted. It is counted from a baseline, GitHub's own count of the author's pull requests opened before {{windowStart}}, plus the author's pull requests in the data opened since then and before this one. So it is unknown for a pull request opened before {{windowStart}}, and for an author with no baseline: accounts GitHub types as bots and deleted accounts get none. The standing filter's "unknown" band holds these.

On the data as of {{asOf}}, standing is unknown for {{standing.unknown}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months: {{standing.unknownBeforeWindow}} opened before {{windowStart}}, and {{standing.unknownInWindow}} opened since then by an author with no baseline.

## Older pull requests

Some rules read things a pull request need not have: reviews with a verdict, draft events, the checklist of the pull-request template, tracker tickets, and trailers that disclose tool use. A pull request without them, as an older one can be, is counted by the same rules, which then give:

- **No draft events**, and not a draft now: it was opened ready for review, and its waiting clock starts at its opening ([Responses, reviews and the waiting clock](#responses)).
- **No reviews**: its first response is the first comment by another person that is not a bot command, and it has no approval, so once finished it counts as finished without one. A week in which no selected pull request had a review has no one giving reviews in the [review capacity chart](#review-capacity). Every pull request from before GitHub recorded reviews is one of these: see [Reviews before GitHub recorded them](#limits-reviews-before-github-recorded-them).
- **No ticked box, no tracker ticket of a type that gives a kind, and no kind label**: its kind is unknown, unless it is a backport whose original has a kind ([Target, component and kind](#kind)).
- **No disclosing trailer, co-author or phrase**: it is counted as not disclosed, which does not mean that no tool was used ([Disclosure of AI use](#disclosure)).
- **An automated account** that GitHub does not type as a bot and that `data/bots.yaml` does not list counts as a person, and a bot command that `data/commands.yaml` does not list is an ordinary comment ([The hand-edited tables](#tables)).

## Reviews before GitHub recorded them

GitHub began recording reviews of pull requests, with their verdicts of approving, requesting changes or commenting, partway through ceph/ceph's history, on {{const.reviewsRecordedFrom}}. Before then the data holds no review, and no comment on a line of code either, since such comments are read only through the reviews they belong to. Conversation comments are read for every pull request, whenever they were made.

So the activity of a pull request before then is counted as that of one with no reviews, as above, and over a period that starts before that day every figure built from reviews understates review before it:

- **Approvals**: a pull request finished before then had no approval, so the time to a first approval counts it as finished without one, and the time after a first approval leaves it out ([Outcomes over time](#outcomes)).
- **Reviews counted**: the reviews per week, the people giving reviews and the ratios built on them in the [review capacity chart](#review-capacity), the review load, the reviews in the Reviewers table of [the People tables](#people-tables), and the share with a bot review in the [comparison of disclosed and undisclosed pull requests](#disclosure-comparison) count none before then, and the Reviewer filter keeps a person's pull requests from before then only where they left a conversation comment that is not a bot command.
- **First responses**: a first response is a comment or a review ([Responses, reviews and the waiting clock](#responses)), so before then it can only be a conversation comment. A review or a comment on a line of code that came first is not in the data, so the first response can be a later comment, or none, and the Reviewers table can credit it to someone else. This touches every figure built from first responses: the time to a first response and the wait for one, the pull requests waiting for one in the review capacity chart, the Authors table's median to first response, the Reviewers table's first responses and median to them, and the pull-request table's first response.

The data does not say how pull requests were reviewed before then, and these figures say nothing about it. When the period chosen starts before {{const.reviewsRecordedFrom}}, the report says so once, above its first section, naming the Review, AI-use and People sections whose figures it concerns, and links here. The pull-request table's first response, the lanes and a selected pull request's timeline show each pull request's own record, reviews included where there are any, and the note does not name them.

## Small groups and recent weeks

A share or a median over a few pull requests can move a long way with one more, and filters combined can narrow a selection to a handful. The fewer pull requests behind a figure, the less it says.

The most recent weeks hold the youngest pull requests, most of them unfinished, so their times are often not yet known and will change as the data is refreshed. Every time is elapsed calendar time, weekends and holidays included, and says nothing about effort.
