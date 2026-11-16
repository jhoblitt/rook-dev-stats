# Target, component and kind

A pull request's target is the branch it asks to merge into. Its components come from its labels. Its kind, where it can be told, comes from its labels and from the labels of the issues it closes.

## Target

The target is the development branch or another branch, as GitHub reports it at the last fetch. The development branch is `main`, named `master` until its rename: the two names are one branch at different times, and the data holds pull requests under each, so a pull request on either is on the development branch, and the Target filter's `main` keeps both. Every other branch is grouped as "backports and other branches": backports to the stable branches and pull requests to a feature branch or any other branch alike.

## Component

Each label is read through [`data/labels.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/labels.yaml), which says whether it names a component, a process state such as `needs-review`, or neither. A pull request with two component labels belongs to both components; one with none belongs to none. The labels are those the pull request carries at the last fetch, not those it carried earlier.

## Kind

A kind is a bug fix, a feature, a cleanup, documentation, other, or unknown. A backport, a pull request whose description says "backport of" followed by a link to a ceph/ceph pull request or its number, takes the kind of the pull request it backports, when that one is in the data and has a kind. Otherwise the kind comes from the first of these sources that gives one, in the order [`data/kinds.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/kinds.yaml) sets:

- **A label.** A label the table lists, such as `bug`, `feature`, `docs` or `code cleanup`, names a kind, and the labels decide only when every such label on the pull request names the same one.
- **A closing issue's labels.** The issues GitHub links as closed by the pull request are tried in GitHub's order, and the first whose kind labels, the same as a pull request's but `dependencies`, all name the same kind decides. An issue whose labels disagree, or that has none of them, is passed over for the next. An issue of another repository never decides, since its labels are another project's. GitHub links closing issues only for pull requests to the default branch.

A pull request that none of these decides is unknown. On the data as of {{asOf}}, {{kind.unknown}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months are of unknown kind ({{kind.unknownShare}}).

{{table.kindSources}}

## What it cannot show

A label is a statement by whoever set it, and may be wrong: an issue labelled `bug` for what is a new feature makes its pull request a bug fix here. The labels are those at the last fetch, not those set when the pull request merged. None of these is checked against the change itself.
