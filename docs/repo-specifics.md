# What depends on the repository

A registry of every rule, value and assumption in this tool that holds for
one repository and not another, found while porting
[jhoblitt/ceph-dev-stats](https://github.com/jhoblitt/ceph-dev-stats) to
rook/rook. It is the input to a possible generic tool configured per
repository: each entry is something such a tool would have to take as
configuration, or detect, rather than hard-code.

Each entry says what varies, how ceph/ceph and rook/rook differ, where the
rule lives in this tree, and how it was found. "Where" names a file, not a
line, since lines move. Add an entry whenever a change makes the tool fit
Rook where it had fit Ceph.

## Identity and history

### Repository identity and window start
- **Varies:** owner, name, and the first day of the data window.
- **ceph:** `ceph/ceph`, 2011-09-01. **rook:** `rook/rook`, 2016-07-08.
- **Where:** `internal/fetch/fetch.go` (`Owner`, `Name`, `WindowStart`); the
  site takes the repository from the data's `meta.repo`.
- **Found:** porting. The sibling's session reported the identity is these
  three constants plus about ten site strings.

### Names of the tool and the page
- **Varies:** binary, environment prefix, module path, Pages base path, page
  title, theme storage key, package name.
- **ceph:** `cephstats`, `CEPHSTATS_`, `/ceph-dev-stats/`, "Ceph pull
  requests". **rook:** `rookstats`, `ROOKSTATS_`, `/rook-dev-stats/`, "Rook
  pull requests".
- **Where:** the rename commit touches them all. The release files
  (`.github/workflows/release.yml`, `.github/workflows/deploy.yml`,
  `.releaserc.yml`) name neither repository; semantic-release takes the
  repository from the checkout's remote. The published address,
  `https://jhoblitt.github.io/rook-dev-stats/`, follows from the repository
  name and is in `README.md`.
- **Found:** porting.

### Size of the history
- **Varies:** how many pull requests the whole history holds, and so whether
  a first release can carry all of it.
- **ceph:** about 74,000; the whole-history walk took about 4.9 hours.
  **rook:** 11,876; a cold whole-history walk took about 35 minutes.
- **Where:** a deployment decision, not code.
- **Found:** measured on both.

### Count source for the completeness check
- **Varies:** whether GitHub's listing total or its search count is the
  reference, depending on whether the window starts at the repository's
  creation.
- **ceph/rook:** both windows start at creation, so both use the listing.
  The search undercounts on ceph.
- **Where:** `internal/fetch`, the count at the end of a walk.
- **Found:** the sibling.

### Reviews recorded from
- **Varies:** nothing per repository: GitHub holds no reviews before
  2016-09-14. A repository created earlier has an early stretch with
  comments but no reviews.
- **ceph:** five years without reviews. **rook:** two months (2016-07-08 to
  2016-09-14). Rook's earliest review is 2016-09-14.
- **Where:** `site/src/lib/review.ts` (`REVIEWS_RECORDED_FROM`).
- **Found:** the sibling; confirmed on Rook's data.

## Branches

### Development branch names
- **Varies:** the name or names of the development branch over time.
- **ceph:** `master` until 2022, then `main`; both count. **rook:** `master`,
  never renamed.
- **Where:** `site/src/lib/filters.ts` (`DEVELOPMENT_BRANCHES`, `TARGETS`),
  `site/src/lib/state.ts` (default target). The target id appears in shared
  links.
- **Found:** porting. The sibling had a rename note (`baseNote`), which became
  dead code with one name and was deleted.

### Release branch naming
- **Varies:** what release and backport branches are called.
- **ceph:** release code names (`squid`, `tentacle`, `umbrella`). **rook:**
  `release-1.x`.
- **Where:** nothing matches on the name: any branch other than the
  development branch is "backports and other branches".
- **Found:** sampling 200 Rook pull requests.

## Backports

### How a backport names its original
- **Varies:** where a backport says which pull request it copies.
- **ceph:** the description says "backport of" and the original's URL or
  `#N`. **rook:** Mergify opens most backports. The description ends "This
  is an automatic backport of pull request #N done by Mergify", and the title
  ends `(backport #N)`.
- **Where:** `internal/extract/hints.go` (`backportOf`).
- **Found:** sampling (76 of the 200 newest Rook pull requests were Mergify
  backports).

### Who authors backports
- **Varies:** whether backports are opened by people or by a bot.
- **ceph:** people. **rook:** mostly `mergify[bot]`, so a third or more of
  pull requests have a bot author.
- **Where:** a presentation decision. The owner chose no author-type filter;
  the target filter separates backports.
- **Found:** sampling.

## Kind of change

### Where a pull request's kind comes from
- **Varies:** the sources that say whether a pull request is a bug fix,
  feature, cleanup or documentation, and their order.
- **ceph:** ticked kind boxes in the PR template, then the type of the
  tracker.ceph.com ticket it references, then kind labels. **rook:** kind
  labels, then the labels of the issues GitHub links as closed by the pull
  request.
- **Where:** `internal/extract/hints.go`, `internal/classify/kind.go`,
  `internal/tables/kinds.go`, `data/kinds.yaml`.
- **Found:** reading Rook's PR template (no kind boxes) and labels.

### External issue tracker
- **Varies:** whether a second host is asked anything.
- **ceph:** tracker.ceph.com (Redmine), asked for ticket types. **rook:**
  none; GitHub issues only.
- **Where:** `internal/tracker` and the `tickets` command, removed for Rook.
- **Found:** porting.

### Closing issues and their repository
- **Varies:** GitHub's closing references exist only for pull requests to
  the default branch, and an issue may belong to another repository.
- **rook:** each cached closing issue keeps its repository. A backport gets
  its kind through its original.
- **Where:** `internal/ghapi/queries.go`, `internal/fetch/cache.go`.
- **Found:** Task 2's implementer and reviewer. A null node in the list is
  skipped where it is read.

## AI disclosure

### Disclosure policy and trailers
- **Varies:** what the project asks for, and which trailer keys mean a
  disclosure.
- **ceph:** an `Assisted-by:` trailer, from a draft rule. **rook:** a
  statement in the PR description is required. `Co-authored-by`,
  `Assisted-by` and `Generated-by` trailers are permitted.
- **Where:** `data/tools.yaml` (trailer keys, phrases, families).
- **Found:** Rook's `Documentation/Contributing/ai-guidelines.md`.

### A PR-template line that mentions AI
- **Varies:** template text that the disclosure word list matches.
- **rook:** the checklist line "Reviewed AI guidelines, if AI assisted with
  the PR" matches `\bAI\b`. It would have made about 830 templated pull
  requests disclose. The owner chose to count a ticked box as its own
  weakest class, "checklist".
- **Where:** `data/tools.yaml` (ignored until the box rule lands),
  `internal/extract/disclosure.go`, `internal/classify/classify.go`.
- **Found:** sampling (99 of 200 ticked it); confirmed by Task 4's report.

## Automation

### Bot commands, and the privacy rule on `@`
- **Varies:** how people trigger automation from a comment.
- **ceph:** Jenkins phrases (`jenkins test make check`, `/audit retest`).
  **rook:** mentions of bot accounts (`@mergifyio backport release-1.21`,
  `@dependabot rebase`). CI suites are triggered by label (`debug-*`,
  `skip-ci`). One Rook command has a no-break space after
  the mention, so the command patterns accept it.
- **Where:** `data/commands.yaml`; and `internal/extract`, whose privacy rule
  dropped the text of any comment containing `@`. For Rook, a leading
  mention of a command bot (`commandBots`: `mergifyio`, `mergify`,
  `dependabot`) is let through when no other `@` follows.
- **Found:** Task 4's spot check. 206 commands on 158 pull requests counted
  as human responses until extract kept the bot-mention form.

### Automation accounts GitHub types as users
- **Varies:** which accounts post automated comments without GitHub's bot
  type.
- **ceph:** `ceph-jenkins`, `loic-bot`. **rook:** `jenkins-rook`, `fossabot`,
  `snyk-bot`, `step-security-bot`, `WSandboxedOCCodeBot`.
- **Where:** `data/bots.yaml`.
- **Found:** `rookstats check --report`.

### Labels
- **Varies:** which labels are components and which are process states.
- **rook:** component labels (`operator`, `block`, `filesystem`, `object`,
  `csi`, `ceph-*`, …), process labels (`backport-release-*`, `do-not-merge`,
  `debug-*`, `skip-ci`, …).
- **Where:** `data/labels.yaml`.
- **Found:** `rookstats check --report`.

## Prose

### Methods pages and README
- **Varies:** every sentence that describes the project's conventions.
- **Where:** `site/src/content/methods/*.md`, `README.md`. Figures are
  placeholders computed from the data; sentences are not.
- **Found:** porting.
