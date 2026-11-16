# Rook pull-request statistics — design

Date: 2026-11-16. Status: approved by the owner 2026-11-16.

## Intent

Give Rook developers the page `jhoblitt/ceph-dev-stats` gives Ceph
developers, built from `rook/rook`'s pull requests: how much work arrives,
lands and is abandoned; whether disclosed AI assistance is changing how pull
requests are written and handled; and whether human review has become the
bottleneck. The working thesis and the rule that the page shows evidence for
or against it, never assumes it, carry over unchanged.

The sibling's design,
`jhoblitt/ceph-dev-stats:docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md`,
is the base. Its goals, non-goals, anti-goals, definitions, statistics and
page carry over as amended by what the sibling shipped through its latest
release (summarised under "The sibling as shipped"). This document states only
what differs for Rook and why.

## Decisions made by the owner

- **An equivalent of ceph-dev-stats for rook/rook**, in a new repository
  `jhoblitt/rook-dev-stats`, which is **public**, its page public from the
  first release as the sibling's is.
- **Copy and adapt**, not a shared codebase. The owner took this path after
  the sibling's session reported its work largely done. The sibling's
  session recommended the same: the repository identity is a few
  constants and strings, but the semantics (where a pull request's kind
  comes from, the PR template, the backport convention, bot commands,
  label classes, and the methods prose that must stay true of the code)
  differ per project, and one codebase would need an abstraction over all
  of it and verification against two datasets on every release.
- **The copy waits** for the sibling's in-flight plot change, and is taken
  from the release that carries it: `v1.8.0`, commit `d67b5b2`, which draws
  the AI-use tool chart as one plot with a line per tool family. The
  site's per-family colours, markers and dashes are keyed by family id, so
  they follow whatever families Rook's tools table settles on.

## The sibling as shipped

The base spec is stale in places; the shipped sibling governs where they
differ:

- The whole history is fetched, committed and published, and the report
  opens on it. There is no six-month first version.
- Count agreement is against the repository listing's total, within 0.5%.
- "AI use", never "LLM", wherever a reader sees it.
- Pull requests of deleted accounts are credited to the name on their
  commits; the rest are pooled beneath the people tables, unranked.
- Every chart follows the selected period, with drag-to-zoom, section links,
  a pinned period banner and legends above each plot. Weekly steps become
  monthly beyond about a year.
- Fetch has `--full`, `--refetch`, retries on transient failures, and marks
  cached entries GitHub no longer has.
- Release is semantic-release only; deploy goes to GitHub Pages from the
  release workflow.

## What differs for Rook, and why

### Repository and window

`rook/rook` was created 2016-07-08 and holds about 11,900 pull requests
(10,241 merged, 1,581 closed unmerged, 54 open, read 2026-11-16), a sixth of
ceph/ceph's. The window starts at the repository's creation, and the first
release carries the whole history. At the sibling's measured rate a cold
whole-history fetch takes about an hour.

GitHub holds no reviews before 2016-09-14, so Rook's first two months have
comments but no reviews; the sibling's note on this applies as is.

### Branches

The development branch is `master` and has never been renamed. Release
branches are `release-1.x`. The development target is labelled `master`; the
sibling's "named master until its rename" wording does not apply and goes.

### Backports

Mergify opens most backports: a `backport-release-1.x` label or an
`@Mergifyio backport release-1.x` comment on a merged pull request makes
`mergify[bot]` open one on the release branch, titled `… (backport #N)`,
whose description is the original's followed by "This is an automatic
backport of pull request #N done by Mergify". In the 200 newest pull requests
76 are Mergify backports. A backport's link to the pull request it copies is
read from that sentence or from the title suffix, replacing the sibling's
"backport of <ceph/ceph URL>" rule. Hand-made backports to release branches
remain "backports and other branches" by branch, as in the sibling.

A backport carries the original's description, so its disclosure describes
the original work, which is the sibling's rule already.

### Kind of change

Rook has no external tracker and its PR template has no kind boxes, so the
`tickets` step and the tracker client go. As in the sibling, a backport
takes the kind of the pull request it copies when that one is in the data
and has a kind; otherwise its own sources decide. Those sources are, in an
order the kinds table sets:

1. the pull request's own kind labels (`bug`, `feature`, `docs`,
   `code cleanup`, `code enhancement`, `technical debt`, and `dependencies`
   as other), deciding only when they agree;
2. the labels of the issues GitHub links as closed by the pull request
   (its closing references, which GitHub fills from `Resolves #N` and the
   like in the description), the first linked issue whose labels give a
   kind deciding.

The closing references and their labels are read in the same GraphQL
request that fetches the pull request, so no separate step or second host is
needed. GitHub fills closing references only for pull requests to the
default branch, which is why a backport relies on its original.

Kind labels are rare in recent Rook pull requests (in the 200 newest, one
`docs` and 41 `dependencies`; 14 link a closing issue), so most will be
unknown. The page already shows how many are unknown; that number will be
large and the methods page says why.

### AI disclosure

Rook's AI guidelines (`Documentation/Contributing/ai-guidelines.md`) ask
contributors to disclose AI assistance in the pull request description, and
permit but do not require `Co-authored-by`, `Assisted-by` and
`Generated-by` trailers. The sibling's disclosure categories apply as they
are; `Generated-by:` is added beside `Assisted-by:` as a trailer.

Forms seen in the 200 newest pull requests:

- trailers: `Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>` and
  other Claude model names (most common), `Assisted-by: Claude Code …`,
  `Assisted-by: claude-sonnet-5-5 (via Claude Code)`;
- descriptions: "AI assistance: …", "**AI assistance:** …", "AI disclosure:
  …", "AI-assisted: …", "🤖 Generated with [Claude Code](…)", "AI tools were
  used as an aid while drafting…", "This change was assisted with AI.",
  "prepared with an AI coding agent (Claude)".

The PR template carries a checklist box, "Reviewed AI guidelines, if AI
assisted with the PR", ticked in 99 of the 200. **The owner's decision:**
a ticked box counts as a disclosure, in its own category, "checklist only",
below the sibling's three: a pull request that also discloses by trailer,
co-author or description is counted under that stronger form. A
checklist-only disclosure names no tool and goes to the `unspecified`
family. The builder had proposed recording the box without counting it,
since the box is conditional and some contributors tick every box; the
owner chose to count it. The methods page says what the box asks and that
a ticked box is the weakest form.

### Bots and bot-authored pull requests

GitHub types `mergify`, `dependabot`, `github-actions` and
`copilot-pull-request-reviewer` as bots, so they need no table entry. Rook's
user-typed automation accounts, if any, are found through `check --report` as
in the sibling.

Bots author a large share of Rook's pull requests: in the 200 newest,
`mergify` opened 76 (the backports) and `dependabot` 41, 31 of them to
`master`. **The owner's decision:** no author-type filter; bot-authored
pull requests stay in every figure, as in the sibling, and the existing
author filter and people tables are how a reader isolates them. Mergify's
backports are separated by the target filter, and Dependabot's pull requests
to `master` are counted with the rest. The builder had proposed a filter
defaulting to people's pull requests; the owner declined it.

### Bot commands

Rook's commands are Mergify's and Dependabot's (`@mergifyio backport …`,
`@mergifyio rebase`, `@mergify rebase`, `@dependabot rebase`, …), not
Jenkins'. Mergify's own replies ("This pull request is merged…") are from
a bot account and already count as such. The full list is built from
`check --report` over the whole history, as in the sibling. Rook triggers
optional CI suites by label (`debug-*`, `skip-ci`), not by comment; those
labels are process labels, not commands.

### Labels

Component labels: `operator`, `block`, `filesystem`, `object`, `csi`,
`ceph-*`, `helm`, `monitoring`, `multus`, `nvmeof`, and the like. Process
labels: `backport-release-*`, `do-not-merge`, `do-not-backport`, `WIP`,
`conflicts`, `stale`, `keepalive`, `queued`, `dequeued`, `on hold`,
`skip-ci`, `debug-*`. The full classification is the builder's, enforced by
`check` as in the sibling.

### Names

Module `github.com/jhoblitt/rook-dev-stats`, binary `rookstats`, environment
prefix `ROOKSTATS_`, Pages base path `/rook-dev-stats/`, page title "Rook
pull requests", theme storage key `rook-dev-stats:theme`.

## Constraints

As the sibling's, with these changes:

- No host other than GitHub is contacted.
- The repository identity (owner, name, window start) lives in one place in
  Go, as the sibling's does, and the site takes it from the data, so the
  identity is never spelled out twice.
- What is not copied: the sibling's raw cache (private: it holds whole commit
  messages), its records, meta, author baselines and tracker data, its
  development ledger, and its Go and site test fixtures, which are rebuilt
  from Rook-shaped data.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A (chosen) | Copy the sibling's tree at a release, rename, then adapt the Rook-specific parts | Fast, and each site is free to fit its project; generic fixes are carried between the two by hand, by cherry-pick from a `ceph-dev-stats` remote |
| B | Make ceph-dev-stats take a per-repository configuration first, and build both sites from one codebase | Generic fixes reach both for free; needs an abstraction over every project-specific rule above and two-dataset verification on every release, and delays Rook behind a refactor of an active repository |

## History of the copy

The repository starts with a fresh history, not the sibling's: the sibling's
history carries 138 MB of Ceph records. The first commit is the sibling's
tree at the chosen release, without the excluded files, and names the
release it came from. The second is a pure rename (module, binary,
environment prefix, titles, base path), so a diff against the sibling stays
readable and generic fixes can be cherry-picked by path. Rook-specific
changes follow as their own pull requests.

**Superseded by the owner, 2026-11-16, after approval:** publish early. The
release and deploy workflows land third, right after the rename and the
switch to rook/rook, and the data fourth, so the owner can use the live page
while the Rook-specific rules land. Until the methods prose is true of Rook,
the page carries a work-in-progress banner. The plan carries the order. The
paragraph below is kept as the call the owner overruled.

**Builder's call (overruled):** the release and deploy workflows are held out of the
first two commits and land last, in their own pull request, once the page
is right for Rook: the Rook-specific changes, the methods prose and the
whole-history data are in. v1.0.0 is therefore the first public page, and no
version ever shows Ceph wording or tracker-based kinds. The first two
commits are pushed directly when the repository is created, before the
ruleset exists; CI may be red on them until the fixtures are rebuilt, and
the ruleset is applied once the bootstrap pull request has produced the
check names.

## Repository, release and deploy

As the sibling, configured from the sibling's settings as read back on
2026-11-16 and before the release workflow merges (its merge publishes
v1.0.0): Pages from Actions; a `github-pages` environment allowing `main`
and `v*`; a default-branch ruleset (squash only, required checks added once
they exist); delete branch on merge; secret scanning and push protection;
Scorecard and CodeQL scheduled. The sibling's lessons apply: wait for each
release run before the next merge, and the deploy makes the built files
world-readable.

**The owner grants** what the sibling had: create and
configure the repository, open pull requests and merge them once CI is
green, checking in at milestones, the first being the first viewable page.

## Verification

As the sibling's, over Rook data:

- Go tests over recorded Rook responses: a Mergify backport, a Dependabot
  pull request, a pull request with a closing issue carrying `bug`, each
  disclosure form listed above, the AI-guidelines box ticked and unticked.
- Counts agree with the repository listing's totals within 0.5%.
- The site's unit tests and smoke test rebuilt over a Rook-shaped fixture.
- A spot check of a sample of pull requests against their GitHub pages.

## Left to the builder

- The first contents of the tables (labels, commands, bots, kinds, tools)
  beyond what is listed here.
- The methods prose, rewritten to be true of Rook and of the code.
- The exact fields for the closing issues' labels and the AI-guidelines box.
