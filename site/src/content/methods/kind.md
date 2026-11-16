# Target, component and kind

A pull request's target is the branch it asks to merge into. Its components come from its labels. Its kind, where it can be told, comes from what the pull request, its tracker tickets and its labels say about it.

## Target

The target is the development branch or another branch, as GitHub reports it at the last fetch. The development branch is `main`, named `master` until its rename: the two names are one branch at different times, and the data holds pull requests under each, so a pull request on either is on the development branch, and the Target filter's `main` keeps both. Every other branch is grouped as "backports and other branches": backports to the stable branches and pull requests to a feature branch or any other branch alike.

## Component

Each label is read through [`data/labels.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/labels.yaml), which says whether it names a component, a process state such as `needs-review`, or neither. A pull request with two component labels belongs to both components; one with none belongs to none. The labels are those the pull request carries at the last fetch, not those it carried earlier.

## Kind

A kind is a bug fix, a feature, a cleanup, documentation, other, or unknown. A backport, a pull request whose description says "backport of" followed by a link to a ceph/ceph pull request or its number, takes the kind of the pull request it backports, when that one is in the data and has a kind. Otherwise the kind comes from the first of these sources that gives one, in the order [`data/kinds.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/kinds.yaml) sets:

- **The checklist.** A ticked box in the description that begins "New feature", "Very recent bug", "Doc update" or "Code cleanup", the boxes of ceph/ceph's pull-request template, names a feature, a bug fix, documentation or a cleanup. The checklist decides only when every ticked box that names a kind names the same one. "References tracker ticket" names none.
- **A tracker ticket's type.** The tracker.ceph.com tickets a pull request links to, first those on a commit's `Fixes:` line, then those in its description, are tried in that order, and the first whose type gives a kind decides. A Bug is a bug fix; a Feature or an Enhancement a feature; a Cleanup a cleanup; Documentation documentation; a Backport ticket stands for the ticket it was copied from; every other type the table lists is other. A type the table does not list gives no kind, and `cephstats check` fails on it.
- **A label.** The labels `bug-fix`, `feature` and `cleanup` name a kind, and decide only when every such label on the pull request names the same one.

A pull request that none of these decides is unknown. On the data as of {{asOf}}, {{kind.unknown}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months are of unknown kind ({{kind.unknownShare}}).

{{table.kindSources}}

## What it cannot show

A ticket's type is the tracker's own, set by whoever filed or sorted the ticket, and may be wrong: a ticket filed as a Bug for what is a new feature makes its pull request a bug fix here. A type is read from the tracker once and not again, so a type changed on the tracker since then is not seen. A ticked box and a label are likewise statements by whoever set them. None of these is checked against the change itself.
