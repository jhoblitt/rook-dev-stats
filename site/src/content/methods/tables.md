# The hand-edited tables

The judgments that code cannot make are kept in five tables, edited by hand, in the site's repository. They are applied each time the site's data is built, so a change to one needs no new fetch. `cephstats check` fails when the data holds a trailer key or a ticket type that no table accounts for, or a label on 5 or more pull requests that none does, so none of these can go uncounted without notice.

## The five tables

- [`data/tools.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/tools.yaml): what counts as a disclosure of AI use, the trailer keys and the phrases; the tool families; and the candidate lines judged not to be disclosures, each with the reason.
- [`data/bots.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/bots.yaml): the automated accounts that GitHub types as people's, each with the reason.
- [`data/commands.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/commands.yaml): the patterns of the bot commands.
- [`data/labels.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/labels.yaml): which labels name a component, which a process state, and which neither.
- [`data/kinds.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/kinds.yaml): the kinds of change; which checklist box, ticket type and label names which kind; and the order in which those sources are tried.

## What `cephstats check` catches

It runs on every pull request to the repository and every push to its `main`, and at the end of each refresh of the data, and fails when:

- a label on 5 or more pull requests is classified by no table;
- a trailer kept as a candidate has a key that is neither a disclosing key nor `Co-authored-by`, and the table does not list the line as ignored;
- a ticket type read from the tracker has no kind;
- a counted disclosure names no tool family, or the table has no family for a disclosure that names no tool;
- the number of pull requests opened since the window's start, {{windowStart}}, or open now, differs by more than 0.5% from GitHub's own count, which a fetch reads as it ends;
- a table does not load, or holds a key it does not define.

## What it does not catch

A label on fewer than 5 pull requests is not flagged. An automated account that GitHub types as a person counts as a person until `data/bots.yaml` lists it, and a bot command that `data/commands.yaml` does not list counts as an ordinary comment. For those, `cephstats check --report` lists the accounts with the most comments that GitHub does not type as bots, and the short comments that match no command, for whoever edits the tables to read.
