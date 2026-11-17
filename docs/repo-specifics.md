# What depends on the repository

A registry of every rule, value and assumption in this tool that holds for
one repository and not another, found while porting
[jhoblitt/ceph-dev-stats](https://github.com/jhoblitt/ceph-dev-stats) to
rook/rook. It is the input to a possible generic tool configured per
repository: each entry is something such a tool would have to take as
configuration, or detect, rather than hard-code. ceph-dev-stats keeps the
same registry from Ceph's side, in its
[`docs/repo-specifics.md`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/docs/repo-specifics.md);
the Ceph lines here follow it.

Each entry says what varies, how ceph/ceph and rook/rook differ, where the
rule lives in this tree, and how it was found. "Where" names a file, not a
line, since lines move. Add an entry whenever a change makes the tool fit
Rook where it had fit Ceph.

## Identity and history

### Repository identity and window start
- **Varies:** the owner, the name, and the first day of the data window.
- **ceph:** `ceph/ceph`, 2011-09-01. **rook:** `rook/rook`, 2016-07-08.
  Each window starts on the day GitHub says the repository was created, so
  it covers the whole history.
- **Where:** `internal/fetch/fetch.go` (`Owner`, `Name`, `WindowStart`). The
  site builds every GitHub address from the data's `meta.repo`, and the
  commands' help text (`internal/cli`) names the repository from `Owner`
  and `Name`. The methods pages and the README spell it in prose.
- **Found:** porting. The sibling reported that the identity is these three
  constants plus about ten site strings.

### Names of the tool and the page
- **Varies:** the binary, environment prefix, module path, Pages base path,
  page title, theme storage key, footer repository link and package name.
- **ceph:** `cephstats`, `CEPHSTATS_`, `/ceph-dev-stats/`, "Ceph pull
  requests". **rook:** `rookstats`, `ROOKSTATS_`, `/rook-dev-stats/`, "Rook
  pull requests".
- **Where:** the rename commit touches all of them.
- **Found:** porting.

### Size of the history
- **Varies:** how many pull requests the whole history holds, and so whether
  a first release can carry all of it.
- **ceph:** 73,918. A whole-history walk fetched about 63,500 of them in
  4.9 hours, resuming from a partial cache. The cache is 673 MB and the
  records 138 MB.
- **rook:** 11,876. A cold whole-history walk took about 35 minutes. The
  cache is 100 MB and the records 20 MB.
- **Where:** a deployment decision, not code.
- **Found:** measured on both.

### Count source for the completeness check
- **Varies:** whether GitHub's listing total or its search count is the
  reference. The listing serves only a window that starts at or before the
  repository's creation.
- **ceph/rook:** both use the listing. On ceph the search undercounts:
  72,447 against the listing's 73,914.
- **Where:** `internal/fetch/fetch.go`, `internal/classify/check.go`, and
  `data/meta.json` (`opened_in_window_source`).
- **Found:** the sibling.

### Reviews recorded from
- **Varies:** nothing per repository. GitHub announced pull-request reviews
  on 2016-09-14 and holds none before then, so a repository created earlier
  has an early stretch with comments but no reviews.
- **ceph:** five years of it; the earliest review is on 2016-09-29.
- **rook:** two months, 2016-07-08 to 2016-09-14; the earliest review is on
  2016-09-14.
- **Where:** `site/src/lib/review.ts` (`REVIEWS_RECORDED_FROM`).
- **Found:** the sibling, then confirmed on Rook's data.

### Deleted accounts
- **Varies:** how many pull requests belong to accounts GitHub has deleted.
- **ceph:** 1,353 pull requests have no author. 1,351 of them are credited
  to the name on their commits, 33 names in all. The rule itself is
  generic: the most common committer name, with GitHub's own web committer
  set aside, and never an address.
- **rook:** see the records. The same rule applies.
- **Where:** `internal/fetch/names.go`, `internal/record/record.go`,
  `internal/rollup/rollup.go`, `site/src/lib/handles.ts`.
- **Found:** the sibling's whole-history data.

## Branches

### Development branch names
- **Varies:** the name or names of the development branch over time.
- **ceph:** `master` until 2022, then `main`, and both count. The records
  hold 33,057 pull requests on `master` and 17,229 on `main`.
- **rook:** `master`, never renamed.
- **Where:** `site/src/lib/filters.ts` (`DEVELOPMENT_BRANCHES`, `TARGETS`)
  and `site/src/lib/state.ts` (the default target). The target id appears in
  shared links. The sibling's rename note (`baseNote`) became dead code with
  one name and was deleted.
- **Found:** porting.

### Release and other branches
- **Varies:** what branches other than the development branch are called.
- **ceph:** 153 base branches, among them release code names (`reef`,
  `squid`, …), feature branches and `wip-*` branches.
- **rook:** `release-0.x` and `release-1.x`, and a handful of one-off
  branches.
- **Where:** nothing matches on the name. Any branch other than the
  development branch is "backports and other branches", and the Branch
  filter offers whatever the data holds.
- **Found:** sampling, and counting base branches.

## Backports

### How a backport names its original
- **Varies:** where a backport says which pull request it copies.
- **ceph:** the description says "backport of" followed by the original's
  address or `#N`. 10,219 of the 23,632 pull requests off the development
  branch carry it.
- **rook:** Mergify opens most backports. Its description ends "This is an
  automatic backport of pull request #N done by Mergify" ("automated" in
  older versions), and its title ends `(backport #N)`, or `(bp #N)` in
  older versions. People write "backport of #N" or the same title
  suffixes, with or without the space or the `#`. The first that names a
  pull request other than the backport itself decides: Mergify's sentence,
  then "backport of" with `#N` or this repository's address, then the
  title's suffix. A backport of a backport carries two of Mergify's
  sentences; the first, the original's, wins. In a title, a number with no
  `#` before it and a dot after it is a release: `(backport 1.5)` names no
  pull request.
- **Where:** `internal/extract/hints.go` (`mergifySentence`, `backportOf`,
  `titleSuffix`); the address is built from `internal/fetch/fetch.go`
  (`Owner`, `Name`).
- **Found:** the raw cache. 3,297 of Mergify's 3,308 pull requests name
  an original, 3,295 by its sentence and 2 by their title alone. The
  other 11 are not backports: a configuration pull request and 10 of its
  11 merge-queue pull requests. The eleventh, #18779, is titled with the
  backport it merged, `(backport #18723)` included, so it is linked by its
  title to #18723 and takes that pull request's kind. 3,421 of the 11,876
  pull requests name an original, 3,420 of the 4,033 off `master`, and 8
  name one GitHub no longer serves. Linking them cuts the kind unknown off
  `master` from 99.0% (3,992) to 66.1% (2,665).

### Who makes a backport, and what its commits carry
- **Varies:** whether people or a bot open backports, and whether the copied
  commits keep their dates and authors.
- **ceph:** people, by cherry-pick. The commits keep their author dates, so a
  backport's first commit is the original work's.
- **rook:** mostly `mergify[bot]`, by cherry-pick, so a third or more of
  pull requests have a bot author. The owner chose no author-type filter;
  the target filter separates backports.
- **Where:** `internal/extract/disclosure.go` (cherry-pick lines),
  `internal/fetch/names.go` (committers before authors).
- **Found:** sampling.

## Kind of change

### Where a pull request's kind comes from
- **Varies:** the sources that say whether a pull request is a bug fix,
  feature, cleanup or documentation, and their order.
- **ceph:** a backport takes the kind of the pull request it names.
  Otherwise, in order:
  - the ticked boxes of the PR template's Tracker section;
  - the type of the first tracker.ceph.com ticket it references;
  - the labels `bug-fix`, `feature` and `cleanup`.
- **rook:** a backport takes its original's kind. Otherwise, in
  `data/kinds.yaml`'s `order: [labels, issues]`:
  - kind labels: `bug`, `feature`, `code enhancement`, `docs`,
    `code cleanup`, `technical debt`, and Dependabot's `dependencies` as
    other;
  - then the first closing issue whose `issue_labels` agree on a kind.
    Issues and pull requests share the repository's labels, so
    `issue_labels` lists the same kind labels as `labels` but
    `dependencies`. Area labels such as `test`, `build` and `ci` name no
    kind. Only issues of rook/rook count: another project's labels mean
    other things.

  Rook's template has no kind boxes, so the checklist source, the
  `Check*` hints and the `checklist` table are gone.
- **Where:** `internal/extract/hints.go` (`Hints`) and
  `internal/extract/extract.go` (`closingIssues`), `internal/classify/kind.go`
  (`issuesKind`, `ownRepository`), `internal/tables/kinds.go`
  (`SourceLabels`, `SourceIssues`), `data/kinds.yaml`.
- **Found:** the two projects' PR templates and labels. On rook/rook's
  whole history the kind is unknown for 64.5% of the 7,843 pull requests
  to `master`, and for 76.2% (9,053) of all 11,876 before backports are
  linked to their originals, 65.1% (7,726) after.

### External issue tracker
- **Varies:** whether issues live on GitHub or on another host that the tool
  must ask.
- **ceph:** issues are switched off on GitHub. Work is tracked on
  tracker.ceph.com, a Redmine, referenced by a `Fixes:` trailer or the
  ticket's address. A Backport ticket stands for its parent's type: 15,116
  of 34,457 saved tickets are of that type.
- **rook:** GitHub issues only. No second host is asked.
- **Where:** removed for Rook: the `internal/tracker` package, the
  `tickets` command, `data/tickets.json`, the `tracker` table of
  `data/kinds.yaml` and the `Fixes:` trailer ticket extraction. The site
  links an issue on GitHub instead of on the tracker.
- **Found:** porting. 33 rook/rook pull requests name a tracker.ceph.com
  ticket in a `Fixes:` trailer or their description; those tickets no
  longer decide anything.

### Closing issues
- **Varies:** whether GitHub's closing references exist to read, and where
  the issues live.
- **ceph:** none; the repository has no GitHub issues.
- **rook:** read for every pull request. GitHub fills them only for pull
  requests to the default branch, so a backport gets its kind through its
  original. An issue may belong to another repository, so each cached issue
  keeps its repository. A null entry in the list is skipped where it is
  read. The record keeps every issue in GitHub's order, with its
  repository and labels (`kind_hints.issues`); only rook/rook's decide a
  kind, and the site links each at its own repository's address. 2,191
  pull requests close at least one issue; 8 close one in another
  repository.
- **Where:** `internal/ghapi/queries.go`, `internal/fetch/cache.go`,
  `internal/extract/extract.go` (`closingIssues`), `internal/record/hints.go`
  (`Issue`), `internal/rollup/year.go` (the table file's `issues`),
  `site/src/lib/table.ts` (`issueUrl`, `issueName`),
  `site/src/components/SelectedPr.svelte`.
- **Found:** Task 2's implementer and reviewer.

## AI disclosure

### Disclosure policy and trailer keys
- **Varies:** what the project asks for, and which trailer keys mean a
  disclosure.
- **ceph:** no rule in the tree; pull requests quote a documented format
  for an `Assisted-by:` trailer. The keys counted are `assisted-by`,
  `assistant-by`, `assited-by`, `ai-assisted-by`, `claude-session` and
  `generated-by`.
- **rook:** `Documentation/Contributing/ai-guidelines.md` requires a
  statement in the PR description. It permits `Co-authored-by`,
  `Assisted-by` and `Generated-by` trailers. The PR template's
  AI-guidelines box, ticked, counts as the weakest class, "checklist" (see
  below).
- **Where:** `data/tools.yaml`, `internal/extract/disclosure.go`,
  `internal/classify/classify.go`.
- **Found:** each project's documents and `check --report`.

### Tool families
- **Varies:** which tools contributors name, and the spellings that need a
  ruling.
- **ceph:** Copilot, Cursor, IBM Bob, Claude, OpenAI, Gemini, and
  "unspecified"; a bare "Bob" is IBM Bob.
- **rook:** the same families. An "opencode / GLM" disclosure stays
  unspecified.
- **Where:** `data/tools.yaml` (`families`), `site/src/lib/colours.ts`
  (`FAMILY_LINES`, a colour, marker and dash for each family id).
- **Found:** `check`, which fails on a counted disclosure that matches no
  family.

### Template and policy text that mentions AI
- **Varies:** text that the project's own templates and rules put into many
  pull requests, which the disclosure word list matches.
- **ceph:** the template does not mention AI. Lines quoting the trailer
  rule are listed in `ignore`.
- **rook:** the template line "Reviewed AI guidelines, if AI assisted with
  the PR" matches `\bAI\b`. It is in about 830 pull requests. The owner
  chose to count a ticked box as its own, weakest class, "checklist",
  which names no tool. extract reads a description's checklist line whose
  label starts with "reviewed" and holds "ai guidelines" as the box: a
  ticked one sets the record's `checklist`, and is a candidate only when
  it says more than the template, as some authors' "(Prepared with AI
  assistance; …)" does. Rewordings such as "Reviewed the AI guidelines"
  or "when AI assisted" say no more. An unticked box is never a
  candidate, whatever it says. A Mergify backport joins its own sentence
  to its original's description with `<hr>`, so when the box ends the
  description the sentence lands on the box's line; the label is judged
  only up to the `<hr>` that Mergify's "This is an automatic backport"
  follows, so anything else after an `<hr>` is still read. In the data
  of 2026-11-16, 416 of 11,876 pull requests tick the box, 106 of them
  disclosing in no other way.
- **Where:** `internal/extract/disclosure.go` (`aiBox`),
  `internal/classify/classify.go`, `site/src/lib/timeline.ts`
  (`DISCLOSURE_WORDS`), `site/src/lib/methods/present.ts`.
- **Found:** sampling (99 of 200 ticked it), confirmed by `check --report`.

### Trailers that name people
- **Varies:** which commit trailers carry a person's name and address.
- **ceph/rook:** both require `Signed-off-by:` (DCO). A line with that key
  or another key on the never-kept list is never kept, and a candidate line
  holding an address is withheld.
- **Where:** `internal/extract/disclosure.go` (`neverKept`, `withhold`).
- **Found:** the sibling.

## Automation

### Bot commands, and the rule on `@`
- **Varies:** how people trigger automation from a comment.
- **ceph:** whole-comment phrases, none with an `@`:
  - to Jenkins: `jenkins test make check`, `jenkins test windows`,
    `jenkins test api`, `jenkins retest this please`, "retest this please",
    "test this please", "ok to test";
  - to the release-engineering audit bot: `/audit retest`,
    `/audit override`;
  - also `/config check ok` and `unstale`.
- **rook:** mentions of bot accounts (`@mergifyio backport release-1.21`,
  `@dependabot rebase`). The command patterns accept any white space after
  the mention, as extract does; one comment has a no-break space there. CI
  suites are triggered by label (`debug-*`, `skip-ci`), not by comment.
- **Where:** `data/commands.yaml`, and `internal/extract/extract.go`
  (`commentText`). That rule keeps a comment's text only when it is one line
  of at most 80 characters with no `@`. For Rook, a leading mention of a
  command bot (`commandBots`: `mergifyio`, `mergify`, `dependabot`) is let
  through when no other `@` follows.
- **Found:** Task 4's spot check. 206 commands on 158 pull requests counted
  as human responses until extract kept the bot-mention form.

### Automation accounts GitHub types as users
- **Varies:** which accounts post automated comments without GitHub's bot
  type.
- **ceph:** `ceph-jenkins`, which also opens the release-version pull
  requests, and `loic-bot`, a make-check bot of 2014 and 2015.
- **rook:** `jenkins-rook`, `fossabot`, `snyk-bot`, `step-security-bot`,
  `WSandboxedOCCodeBot`.
- **Where:** `data/bots.yaml`.
- **Found:** `check --report`.

### Labels
- **Varies:** which labels are components and which are process states, and
  who sets them.
- **ceph:** 31 components, most set by a labeler from the paths a pull
  request touches. Process labels are `needs-*`, `wip-*`, `releng-audit-*`
  and `backport*`.
- **rook:** components such as `operator`, `block`, `filesystem`, `object`,
  `csi` and `ceph-*`. Process labels such as `backport-release-*`,
  `do-not-merge`, `debug-*` and `skip-ci`.
- **Where:** `data/labels.yaml`.
- **Found:** `check --report`.

## Prose and tests

### Methods pages and README
- **Varies:** every sentence that describes the project's conventions.
- **ceph:** the tracker and its tickets, the `master`-to-`main` rename,
  Jenkins and audit-bot commands, and Ceph's draft trailer rule.
- **rook:** `master` only; kind from labels and closing issues, with the
  10-issue and 20-label limits of a fetch and when an issue's relabelling
  reaches the page; Mergify's backport sentence and title; Mergify and
  Dependabot commands; the AI guidelines of 2026-04-24, the trailers they
  permit since 2026-07-27, and the box as the weakest disclosure; no
  external tracker; a window from the repository's creation, so no pull
  request is opened before it and every author's baseline is 0.
- **Where:** `site/src/content/methods/*.md`, `README.md`. Figures are
  placeholders computed from the data; sentences are not.
  `site/src/lib/methods/content.test.ts` lists the numbers a page may
  type, such as those limits and dates, each with its reason.
- **Found:** porting, each sentence read against the code it describes.

### Test data
- **Varies:** the examples the tests are built from.
- **ceph:** recorded responses and fixtures carry Ceph's tracker addresses,
  backport descriptions and dates.
- **rook:** rook/rook throughout: `master` and `release-1.x`, Rook's
  labels and components, Mergify, Dependabot and "ok to test" commands,
  and Rook's PR template. The site fixture keeps the times and sizes its
  specs pin, with Rook's identities: a Mergify backport, a Dependabot
  update, a backport linked to its original that ticks the AI-guidelines
  box, and closing issues, one in another repository. The long-history
  fixture starts in 2016. Issues closed in another repository use
  `ceph/ceph-csi`, a repository rook/rook's pull requests do close issues
  in.
- **Where:** `internal/extract/testdata`, `site/src/lib/__fixtures__`,
  `site/e2e/smoke.spec.ts`.
- **Found:** the sibling.
