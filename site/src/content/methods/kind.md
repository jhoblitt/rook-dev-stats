# Target, component and kind

A pull request's target is the branch it asks to merge into. Its components come from its labels. Its kind, where it can be told, comes from its labels, from the labels of the issues it closes, or, for a backport, from the pull request it backports.

## Target

The target is the development branch or another branch, as GitHub reports it at the last fetch. The development branch is `master`, the only name it has had. Every other branch is grouped as "backports and other branches": backports to the `release-0.x` and `release-1.x` branches and pull requests to any other branch alike.

## Component

Each label is read through [`data/labels.yaml`](https://github.com/jhoblitt/rook-dev-stats/blob/main/data/labels.yaml), which says whether it names a component, a process state such as `do-not-merge`, or neither. A pull request with two component labels belongs to both components; one with none belongs to none. Maintainers set these labels by hand, and most pull requests carry none. The labels are those the pull request carries at the last fetch, not those it carried earlier.

## Kind

A kind is a bug fix, a feature, a cleanup, documentation, other, or unknown.

A backport takes the kind of the pull request it backports, when that one is in the data and has a kind. Most backports are opened by Mergify, which ends the description with "This is an automatic backport of pull request #N done by Mergify" ("automated" in its older versions) and the title with `(backport #N)`, or `(bp #N)` in its older versions. A backport names its original by the first of these that names a pull request other than itself: Mergify's sentence; "backport of" followed by `#N` or the address of a rook/rook pull request; or a title ending in `(backport #N)` or `(bp #N)`, written with or without the space or the `#`. A number after "backport" with a dot after it and no `#` before it, as in `(backport 1.5)`, is a release, not a pull request. A backport whose original is not in the data, or has no kind, is decided as any other pull request.

Otherwise the kind comes from the first of these sources that gives one, in the order [`data/kinds.yaml`](https://github.com/jhoblitt/rook-dev-stats/blob/main/data/kinds.yaml) sets:

- **A label.** A label the table lists names a kind: `bug` a bug fix; `feature` and `code enhancement` a feature; `code cleanup` and `technical debt` a cleanup; `docs` documentation; and `dependencies`, which Dependabot sets on every update it opens, other. The labels decide only when every such label on the pull request names the same kind.
- **A closing issue's labels.** The issues GitHub links as closed by the pull request are tried in GitHub's order, and the first whose kind labels, the same as a pull request's but `dependencies`, all name the same kind decides. An issue whose labels disagree, or that has none of them, is passed over for the next. An issue of another repository never decides, since its labels are another project's. GitHub links closing issues only for pull requests to the default branch, so a backport gets no kind this way; it can take one from its original.

A fetch reads at most the first 10 issues GitHub links as closed by a pull request, and at most the first 20 labels of each. It reads them when it fetches the pull request, so relabelling an issue later reaches this page only when the pull request is fetched again: when it changes for another reason, or when the data is fetched afresh ([How the pull requests are found](#counted-how-the-pull-requests-are-found)).

A pull request that none of these decides is unknown. On the data as of {{asOf}}, {{kind.unknown}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months are of unknown kind ({{kind.unknownShare}}).

{{table.kindSources}}

## What it cannot show

A label is a statement by whoever set it, and may be wrong: an issue labelled `bug` for what is a new feature makes its pull request a bug fix here. Most pull requests carry no kind label and close no issue, so their kind is unknown unless they backport one that has a kind. The labels are those at the last fetch, not those set when the pull request merged. None of these is checked against the change itself.
