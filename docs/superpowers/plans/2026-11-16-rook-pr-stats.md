# Rook pull-request statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `jhoblitt/rook-dev-stats`, the ceph-dev-stats page rebuilt over rook/rook's whole pull-request history.

**Architecture:**
- Copy `jhoblitt/ceph-dev-stats` at `v1.8.0` (`d67b5b2`) into a fresh repository and rename it.
- Point it at rook/rook and start the whole-history fetch.
- Publish early: release and deploy go in third, and the Rook data fourth, behind a work-in-progress banner. The owner can use the live page from then on.
- Replace each Ceph-specific rule with Rook's in its own pull request. Each re-derives the records from the cache and deploys.
- The last task makes the prose true of Rook and removes the banner.

**Tech Stack:** Go 1.27 (cobra, viper, slog, Ginkgo/Gomega), Vite + Svelte + TypeScript, GitHub GraphQL, semantic-release, GitHub Pages — all as the sibling has them.

**Spec:** `docs/superpowers/specs/2026-11-16-rook-pr-stats-design.md`, which builds on the sibling's `docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md` at `v1.8.0`. Read both. The sibling's tree at `v1.8.0` is the reference implementation for everything this plan does not change: `/home/jhoblitt/github/ceph-dev-stats` (read only; never write there).

## Owner's decisions made after the spec

- **Publish early** (2026-11-16). The owner wants to use the real page from early on, not screenshots. So release and deploy come third and the data fourth, overruling the spec's "v1.0.0 is the first right page". Until the last task the page carries a banner reading exactly: `Work in progress: figures and methods are not yet final for Rook.`
- **A local copy too.** Before each task's PR merges, the coordinator serves that branch's site locally (see "Local preview" below) so the owner can try the change first.

## Global Constraints

- Repository `jhoblitt/rook-dev-stats`, public; default branch `main`.
- Module `github.com/jhoblitt/rook-dev-stats`, binary `rookstats` (`cmd/rookstats`), environment prefix `ROOKSTATS_`.
- Source repository `rook/rook`; window start `2016-07-08` (its creation).
- Rook's development branch is `master`; release branches are `release-1.x`.
- Pages base path `/rook-dev-stats/`; page title "Rook pull requests"; theme storage key `rook-dev-stats:theme`.
- No host other than GitHub is contacted.
- "AI use", never "LLM", in anything a reader sees.
- Go follows `go-conventions` (load `go-conventions:go-conventions` before any Go edit); repository, workflow and commit hygiene follow `github-conventions`.
- Every PR title and commit header is a Conventional Commit of at most 100 characters; commitlint checks every commit in a PR.
- Never copy from the sibling: `.cache/`, `data/prs/`, `data/meta.json`, `data/authors.json`, `data/tickets.json`, `.superpowers/`, `.claude/`, `docs/superpowers/`, `site/node_modules/`, `site/dist/`, `site/public/data/`.
- `.github/workflows/release.yml`, `.github/workflows/deploy.yml` and `.releaserc.yml` are held out of Task 1 and land in Task 3.
- One raw cache serves every worktree: `ROOKSTATS_CACHE_DIR=/home/jhoblitt/github/rook-dev-stats/.cache`. It is git-ignored and private (whole commit messages), so it is never committed or copied.
- From Task 4 on, a task that changes what `extract` or `rollup` derives also re-runs `go run ./cmd/rookstats extract` against the cache. It passes `make data-check` and commits the changed `data/` in the same PR, so the deploy shows the change.
- `make check` runs `go test -race` and needs the sandbox disabled; `go mod download` and every `gh` batch likewise. Scratch goes in `$TMPDIR`.
- The owner granted: create and configure the repository, open PRs and merge them once CI is green, checking in at milestones. The milestones are Task 4 (first live page with data) and Task 8 (banner removed).
- Wait for each merge's release run to finish before merging the next PR. A merge during the run cancels it, or leaves semantic-release behind the remote and publishing nothing.
- No Ceph fixture, Ceph table entry or Ceph sentence survives Task 8. A grep for `ceph/ceph`, `tracker.ceph`, `cephstats` and `CEPHSTATS` in the tree, outside comments that credit the sibling, comes back empty.

## Local preview

The coordinator keeps one local dev server running from the worktree of the task in review: `make site-data`, then `npm --prefix site run dev -- --host 127.0.0.1 --port 5173 --strictPort`, in the background. Each new task's server replaces the last. The owner is told the URL, `http://127.0.0.1:5173/rook-dev-stats/`, and what to try. Before Task 4 the site has no data, so the preview starts with Task 4.

## Review Focus

1. **The PR template's AI-guidelines box mentions "AI".** The sibling's broad disclosure word list matches `\bAI\b`, so the box's own line, ticked or not, would become a description candidate. A reader expects an unticked box to disclose nothing, and a ticked box to count only as "checklist". Pinned in Task 7.
2. **A Mergify backport names its original twice, or the two disagree.** The title carries `(backport #N)` and the description "automatic backport of pull request #N". A reader expects the description's sentence to win, then the title, and a PR that names itself to name nothing. Pinned in Task 6.
3. **A closing issue carries conflicting kind labels** (`bug` and `feature`). A reader expects that issue to decide nothing and the next linked issue to be tried. Pinned in Task 5.
4. **A Mergify backport inherits its original's whole description,** including a ticked AI box and "AI assistance:" lines. A reader expects the backport to disclose as its original does, the sibling's rule, and the checklist to be the weakest class even then. Pinned in Task 7.
5. **PRs from before the template had the box or before reviews existed** (2016-07-08 to 2016-09-14). A reader expects them counted as "not disclosed" with no error, and the reviews note to cover the gap without a Rook-specific date. Pinned in Tasks 4 and 7.

---

### Task 1: Create the repository and land the copy

**Files:**
- Create: the whole tree, from `git archive v1.8.0` of the sibling minus the never-copy list and the held-out release files.
- Create: `docs/superpowers/specs/2026-11-16-rook-pr-stats-design.md` and this plan, moved in from the untracked copies in `/home/jhoblitt/github/rook-dev-stats`.

**Interfaces:**
- Produces: a `main` branch whose CI passes, where every name is Rook's but every rule is still Ceph's. Later tasks change rules only.

Ruling against the spec: the spec has the first two commits pushed straight to `main`. `github-conventions`' `references/new-repo.md` requires an empty root commit on `main` and everything else through an `init` PR. The canon is the owner's standing rule, so it wins. The `init` PR is merged by **rebase**, not squash, so the copy and the rename stay separate commits on `main`. Squash-only is set in Task 3.

Ruling against the spec: the spec says the sibling's test fixtures are not copied. They are copied here, so CI stays green through the series, and each is replaced by the task that changes its shape. Task 8's grep proves none survives.

- [ ] **Step 1:** `gh repo create jhoblitt/rook-dev-stats --public`, apply the canon ruleset (`deletion`, `non_fast_forward`) and `--delete-branch-on-merge`, per `references/new-repo.md`. Then copy the sibling's settings that need no check names: rebase and squash merges allowed, merge commits off; squash title `PR_TITLE`, message `COMMIT_MESSAGES`; default workflow permission read; secret scanning and push protection on; Dependabot security updates on.
- [ ] **Step 2:** In `/home/jhoblitt/github/rook-dev-stats`, `git init -b main`, add `origin`, commit `chore: repository root` (empty), and push it. Then enter a worktree with `EnterWorktree` (name `init`).
- [ ] **Step 3: Commit 1, the verbatim copy.** Extract `git -C /home/jhoblitt/github/ceph-dev-stats archive v1.8.0` minus the never-copy list and held-out files. Commit as `chore: copy ceph-dev-stats v1.8.0` with a body naming `jhoblitt/ceph-dev-stats@d67b5b2`.
- [ ] **Step 4: Commit 2, a pure rename.** Rename the module path, `cmd/cephstats` → `cmd/rookstats`, `CEPHSTATS_` → `ROOKSTATS_`, `cephstats` in help text, the Makefile, `.gitignore` and the CI workflows, the Vite and Playwright base path, `site/package.json`'s name, the theme key, `version.ts`'s `REPO_URL`, the page title (four places) and meta description, `CLAUDE.md`'s go-conventions block, and the README's title and badges.
  - Do **not** change `fetch.Owner`/`Name`/`WindowStart`, branch names, tables, fixtures or methods prose.
  - `git diff -M --stat HEAD~1` shows renames and name substitutions only.
  - Commit as `refactor: rename to rook-dev-stats`.
- [ ] **Step 5: Commit 3.** Add the spec and this plan as `docs: add the rook-dev-stats design and plan`.
- [ ] **Step 6: Verify.** Run `make check` (unsandboxed), `make data-check` and `make site-test`; all pass. Run `make site-build`; it succeeds on the empty dataset.
- [ ] **Step 7:** Push `init`, open the PR as a draft assigned to the author, wait for CI to go green, mark it ready, merge with `--rebase`, and `ExitWorktree`.

Ruling: if `check` cannot run without `data/meta.json`, commit one that states the Rook window with zero counts, and say so in the PR. Do not copy Ceph's.

### Task 2: Point the tool at rook/rook, read closing issues, and start the fetch

**Files:**
- Modify: `internal/fetch/fetch.go` (`Owner`, `Name`, `WindowStart`), and the tests that assert them.
- Modify: `internal/ghapi/queries.go` (`pullRequestFields`), the fetch entry type that holds the response, and the recorded responses its tests use.
- Modify: `Makefile`: `data-refresh` no longer runs `tickets`, so no refresh contacts tracker.ceph.com.
- Modify: `site/src/lib/filters.ts` (`TARGETS`, `DEVELOPMENT_BRANCHES`, `MAIN_TARGET_NOTE`, `baseNote`), `site/src/lib/state.ts`'s default target, and their tests.

**Interfaces:**
- Produces: `fetch.Owner == "rook"`, `fetch.Name == "rook"`, `fetch.WindowStart == 2016-07-08T00:00:00Z`.
- Produces: the cache entry holds each PR's `closingIssuesReferences(first: 10) { nodes { number labels(first: 20) { nodes { name } } } }`, selected beside the PR's own fields and not paged. Ten issues and twenty labels each are the limit, and Task 8's methods prose says so. Task 5 reads it; extract ignores it until then.
- Produces: the development target `{id: 'master', label: 'master'}`. The URL hash carries `target=master`; no released link exists yet.

- [ ] **Step 1:** Write the failing tests:
  - fetch's constant specs expect `rook`/`rook` and 2016-07-08;
  - the PR query selects `closingIssuesReferences` with `number` and `labels`;
  - a recorded response carrying two closing issues round-trips through the cache entry;
  - `isDevelopmentBranch('master')` is true and `isDevelopmentBranch('main')` and `isDevelopmentBranch('release-1.21')` are false;
  - `inTarget('master', 'release-1.21')` is false;
  - `baseNote` returns null for `master`.
- [ ] **Step 2:** Run `go test ./internal/...` and `npm --prefix site run test -- filters state`. Both fail.
- [ ] **Step 3:** Implement:
  - change the constants and the target, and add the query field;
  - delete the "named master until its rename" note and every caller's use of it;
  - `DEVELOPMENT_BRANCHES` becomes `['master']`;
  - drop `tickets` from `data-refresh`;
  - keep `REVIEWS_RECORDED_FROM` (2016-09-14) for now; Task 4 confirms it against the data.
- [ ] **Step 4:** Run `make check` and `make site-test`; both pass. Fix every test still expecting `main`.
- [ ] **Step 5:** PR `feat: read rook/rook and treat master as its development branch`, merged on green.
- [ ] **Step 6:** From `main` in the main clone, start `ROOKSTATS_CACHE_DIR=/home/jhoblitt/github/rook-dev-stats/.cache go run ./cmd/rookstats fetch --full` in the background, unsandboxed, with the token from `gh auth token`. It takes about an hour at the sibling's 0.26 s per PR for about 11,900 PRs, and resumes on rerun. Tasks 3 and 4 proceed while it runs.

### Task 3: Release, deploy and the work-in-progress banner

**Files:**
- Create: `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `.releaserc.yml`, from the sibling's at `v1.8.0`, renamed, re-pinned with `pinact run`, and passing `actionlint`.
- Create: `site/src/components/WipBanner.svelte`, shown at the top of the page, and its spec.

**Interfaces:**
- Produces: `WipBanner.svelte`, which renders the decided text verbatim. Task 8 deletes it and its one use.

- [ ] **Step 1: Settings, before the merge.** The merge publishes v1.0.0, so make every setting first:
  - Pages build type `workflow`, HTTPS enforced;
  - a `github-pages` environment allowing branch `main` and tag `v*`;
  - extend the ruleset with `pull_request` (squash only, 0 approvals) and the required checks by the names CI reports on Task 2's PR: `test`, `lint`, `checks`, `govulncheck`, `data-check`, `site`, `commitlint`, `actionlint`, `pin-check`;
  - turn rebase merging off.
  - Read each setting back.
- [ ] **Step 2:** Write the banner's failing spec: the page renders the banner text exactly once, above the period controls. Run it; it fails. Implement; it passes.
- [ ] **Step 3:** Add the three release files. `deploy.yml` keeps the sibling's `chmod -R a+rX site/dist`, without which Pages serves nothing readable.
- [ ] **Step 4:** Run `make check`, `make site-test` and the Playwright smoke test; all pass.
- [ ] **Step 5:** PR `feat: publish the site with a work-in-progress banner` (a `feat`, so it cuts v1.0.0). Merge on green and wait for the release run.
- [ ] **Step 6: Verify.** Tag `v1.0.0` exists, and `https://jhoblitt.github.io/rook-dev-stats/` loads with the banner, an empty dataset, and `v1.0.0` in the footer.

### Task 4: Rook's data and tables (milestone: first live page with data)

**Files:**
- Create: `data/prs/*.jsonl`, `data/meta.json`, `data/authors.json` (written by `extract`).
- Modify: `data/labels.yaml`, `data/bots.yaml`, `data/commands.yaml`, `data/kinds.yaml` (its `labels` section only; the tracker source stays until Task 5), `data/tools.yaml`; `site/src/lib/colours.ts`'s `FAMILY_LINES` if the families change.

**Interfaces:**
- Consumes: Task 2's finished fetch.
- Produces: committed records that `make data-check` passes over.

- [ ] **Step 1:** Once Task 2's fetch has finished, run `extract`, and then `make data-report` with the cache variable set. The report names people, so it stays in `$TMPDIR` and never goes in a commit or a PR.
- [ ] **Step 2:** Fill the tables from the report until `make data-check` passes:
  - labels: every label is a component, a process state or neither. Starting points are in the spec's "Labels".
  - commands: Mergify's and Dependabot's commands as found, e.g. `@mergifyio backport release-1.21`, `@mergifyio rebase`, `@mergify rebase`, `@dependabot rebase`.
  - bots: user-typed automation accounts, each with a `why`.
  - tools: every disclosure spelling mapped to a family, and `Generated-by` added as a trailer key beside `Assisted-by`.
- [ ] **Step 3: Confirm** that the earliest review in the records is on or after 2016-09-14, so `REVIEWS_RECORDED_FROM` is right for Rook. If one is earlier, the constant becomes that review's day.
- [ ] **Step 4:** Spot check five PRs against their GitHub pages: author, state, merge time, first human response, and disclosure class. Include a Mergify backport, a Dependabot PR and a 2016 PR. Note the result in the PR description without naming people.
- [ ] **Step 5:** Start the local preview, and tell the owner the local and live URLs. Kind (mostly unknown), backport links and the AI box come in Tasks 5–7.
- [ ] **Step 6:** PR `chore(data): carry the whole history of rook/rook`, merged on green; wait for the deploy.

### Task 5: Kind from labels and closing issues; remove the tracker

**Files:**
- Delete: `internal/tracker/`, `internal/cli/tickets.go` and its test, `data/tickets.json`.
- Modify: `internal/record/hints.go`, `internal/extract/hints.go`, `internal/extract/run.go`, `internal/classify/kind.go`, `internal/tables/kinds.go`, `data/kinds.yaml`, `internal/rollup` and `internal/cli/{check,rollup}.go` (drop the tickets argument).
- Modify: `site/src/lib/table.ts`, `site/src/components/SelectedPr.svelte`, `site/src/lib/data.ts` and `site/src/lib/methods/{present,figures}.ts`, so tracker links become issue links.
- Test: `internal/extract/hints_test.go`, `internal/classify/classify_test.go`, `internal/tables/tables_test.go`, and the site specs of the touched files.

**Interfaces:**
- Consumes: the cached `closingIssuesReferences` from Task 2.
- Produces: `record.KindHints{ Issues []record.Issue \`json:"issues,omitempty"\`; BackportOf int \`json:"backport_of,omitempty"\` }`, where `record.Issue{ Number int \`json:"number"\`; Labels []string \`json:"labels,omitempty"\` }`, in GitHub's order. `Checklist`, `Tickets` and the `Check*` constants go.
- Produces: `extract.Hints(number int, title string, messages []string, description string, issues []record.Issue) *record.KindHints`, the signature Task 6 relies on. `number` and `title` are unused until Task 6.
- Produces: `tables.SourceLabels = "labels"` and `tables.SourceIssues = "issues"`. `kinds.yaml` holds `kinds`, `labels`, `issue_labels` and `order`. `SourceChecklist`, `SourceTracker` and `Parent` go. The site's kind-source words gain `issues` and lose `checklist` and `tracker`.
- Produces: the site links an issue as `https://github.com/<meta.repo>/issues/<n>`, built from `meta.repo` like every other link.

Behaviour:
- A PR's own kind is the first source in `order` that gives one.
- `labels` gives the kind its labels all agree on, as now (`agreed`).
- `issues` takes the first linked issue whose labels agree on a kind under `issue_labels`. An issue whose labels disagree gives nothing, and the next issue is tried.
- `resolveOriginals` is unchanged: a backport takes its original's kind first.
- First table contents:
  - `labels`: `bug`→bugfix, `feature`→feature, `code enhancement`→feature, `docs`→docs, `code cleanup`→cleanup, `technical debt`→cleanup, `dependencies`→other.
  - `issue_labels`: `bug`→bugfix, `feature`→feature, `docs`→docs.
  - `order: [labels, issues]`.
  - Refine all of these from `data-report`.

- [ ] **Step 1: Failing tests.**
  - extract: a response with two closing issues yields `Issues` in GitHub's order with their labels; a PR with no hints yields nil.
  - classify:
    - labels `bug`+`feature` give no label kind, so the issue decides;
    - issue 1 labelled `bug`+`feature` gives nothing, so issue 2's `feature` decides;
    - a PR whose own source is `issues` reports source `issues`;
    - a backport whose original has a kind reports source `original`.
  - tables: `order` naming `tracker` is rejected; an `issue_labels` value that is not a kind id is rejected.
- [ ] **Step 2:** Run `go test ./internal/...`; the new specs fail.
- [ ] **Step 3:** Implement to the interfaces above. Delete the tracker package and everything that imports it.
- [ ] **Step 4:** Replace the Go testdata whose shape changed (`internal/extract/testdata/*.json` and `*.record.json`) with Rook-shaped responses. Real rook/rook PRs, trimmed, are fine: rook/rook is public and these are its own pages.
- [ ] **Step 5:** Site: issue links replace tracker links; the PR panel's kind explanation names `labels`, `issues` and `original`. Update the site fixture to the new hint shape.
- [ ] **Step 6:** Re-run `extract` and `make data-check`, then record the share of kind `unknown` in the PR description. Run `make check` and `make site-test`; all pass. Grep for `tracker`; it finds nothing outside the methods prose.
- [ ] **Step 7:** Local preview, then PR `feat: decide kind from labels and closing issues, not tracker tickets` with `data/`, merged on green.

### Task 6: Read Mergify's backport link

**Files:**
- Modify: `internal/extract/hints.go` (`backportOf` and its callers).
- Test: `internal/extract/hints_test.go`.

**Interfaces:**
- Consumes: `extract.Hints(number, title, messages, description, issues)` from Task 5.
- Produces: `KindHints.BackportOf`, the PR a backport copies, or 0.

Behaviour: the first of these that names a number other than the PR's own decides:
1. In the description, "automatic backport of pull request #N".
2. In the description, "backport of", optionally followed by a colon, then `#N` or a `github.com/rook/rook/pull/N` address, bare or as a Markdown link. This is the sibling's rule, with the repository read from the identity constants rather than spelled out.
3. In the title, a trailing `(backport #N)`.

- [ ] **Step 1: Failing tests.**
  - Mergify's description sentence alone gives N.
  - The title suffix alone gives N.
  - Both present with different numbers gives the description's.
  - `backport of https://github.com/rook/rook/pull/123` gives 123.
  - A `github.com/ceph/ceph/pull/123` address gives 0.
  - A title `(backport #<own number>)` gives 0.
  - `backport of #0` gives 0.
- [ ] **Step 2:** Run them; they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run `extract`. Count the Mergify-authored PRs with no `backport_of`; the expected answer is near zero, and every one gets investigated. Spot check two backports' links and kinds on GitHub. Run `make check` and `make data-check`; both pass.
- [ ] **Step 5:** Local preview, then PR `feat: link Mergify backports to the pull request they copy` with `data/`, merged on green.

### Task 7: Count the AI-guidelines box as the weakest disclosure

**Files:**
- Modify: `internal/record/record.go` (`Disclosure`), `internal/extract/disclosure.go`, `internal/classify/classify.go`.
- Modify: `site/src/lib/timeline.ts` (`DISCLOSURE_WORDS`), and every site place that names a disclosure class.
- Test: `internal/extract/disclosure_test.go`, `internal/classify/classify_test.go`, `site/src/lib/timeline.test.ts`.

**Interfaces:**
- Produces: `record.Disclosure.Checklist bool \`json:"checklist,omitempty"\``, true when the description ticks the AI-guidelines box.
- Produces: `classify.DisclosureChecklist = "checklist"`, and `DisclosureClasses()` returning `[none, checklist, description, coauthor, trailer]`.
  - Rollup already writes this list into meta and indexes into it, so the site's per-PR `disclosure` index follows.
  - The site counts any class but `none` as disclosed, so a checklist-only PR is "AI use disclosed" with no site change.
- Produces: `DISCLOSURE_WORDS.checklist = \`${DISCLOSED} by the PR template's AI-guidelines box\``.

Behaviour:
- The box line is a checklist line (`- [x]` or `- [ ]`, any case, optional bullet) whose label, lower-cased, starts with `reviewed` and contains `ai guidelines`. That matches the template's Markdown-link form, "Reviewed [AI guidelines](…), if AI assisted with the PR", and plain-text variants.
- A ticked box sets `Checklist`. Ticked or not, the box line is never a description candidate.
- The class is the strongest present, so a ticked box and a trailer give `trailer`.
- A checklist-only disclosure names the `unspecified` family.

- [ ] **Step 1: Failing tests.**
  - extract:
    - the ticked template line sets `Checklist` and yields no description candidate;
    - the unticked line yields neither;
    - a description with no box yields `Checklist: false`, the 2016 shape;
    - a ticked box plus "AI disclosure: Claude Code helped …" yields both.
  - classify:
    - checklist only → `checklist`, family `unspecified`;
    - checklist + `Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>` → `coauthor`;
    - `Generated-by: Claude Code` → `trailer`;
    - a Mergify backport whose description is its original's, box ticked, discloses like the original.
  - site: `DISCLOSURE_WORDS` has an entry for every class meta lists.
- [ ] **Step 2:** Run them; they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run `extract`, then run `make check`, `make data-check` and `make site-test`; all pass.
- [ ] **Step 5:** Local preview, then PR `feat: count the AI-guidelines box as the weakest disclosure` with `data/`, merged on green.

### Task 8: Make the prose true of Rook and remove the banner (milestone)

**Files:**
- Modify: `site/src/content/methods/*.md`, `site/e2e/smoke.spec.ts`, `site/src/lib/__fixtures__/*`, `README.md`.
- Delete: `site/src/components/WipBanner.svelte` and its use and spec.

**Interfaces:**
- Consumes: the data as of Task 7, for `{{placeholder}}` figures and the smoke test's expectations.

- [ ] **Step 1:** Rewrite each methods page so every factual sentence is true of Rook and of the code. Figures stay `{{placeholders}}`; the content test forbids typed numbers. The pages that change most:
  - `kind.md`: labels and closing issues, the ten-issue and twenty-label limits, the backport rule, and the share unknown.
  - `disclosure.md`: Rook's AI guidelines, the box as the weakest class and why it is weak, and `Generated-by`.
  - `tables.md`: Rook's tables.
  - `commands.md`: Mergify and Dependabot.
  - `privacy.md`: no tracker.
  - every page that says `main`: it now says `master`.
  - Add one sentence: the closing issues' labels are read when the PR is fetched, so relabelling an issue later reaches the page only when the PR is fetched again.
- [ ] **Step 2:** Rebuild the site fixture from a small slice of real Rook records. Rewrite `smoke.spec.ts`'s dates and branch names for it.
- [ ] **Step 3:** Rewrite the README for rook/rook: drop `tickets` and tracker.ceph.com, use `ROOKSTATS_`, the 2016-07-08 window and Rook's sizes. Credit the sibling in one line.
- [ ] **Step 4:** Delete the banner.
- [ ] **Step 5:** Run the leftover-Ceph grep from Global Constraints; it is empty. Run `make check`, `make data-check`, `make site-test` and the Playwright smoke test; all pass.
- [ ] **Step 6:** Spot check ten PRs against their GitHub pages: author, state, merge time, first human response, kind and its source, and disclosure class. Include two Mergify backports, one Dependabot PR, one with a closing issue and one 2016 PR.
- [ ] **Step 7:** Local preview; the owner looks before the merge. Then PR `docs(site): describe Rook throughout and drop the work-in-progress banner`, merged on green.
- [ ] **Step 8:** Verify the live page: no banner, the new version in the footer, a filter recomputes, and the PR table links to rook/rook. Report to the owner. The sibling's ledger at `/home/jhoblitt/github/ceph-dev-stats/.superpowers/sdd/2026-11-15-ceph-pr-stats/progress.md` may then be deleted, at the owner's word.
