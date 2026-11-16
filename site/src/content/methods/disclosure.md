# Disclosure of AI use

A pull request discloses AI use when its commit messages or its description say so in one of three forms, and the strongest form it uses is the one it is counted under. A tool's name alone is not a disclosure. "Not disclosed" means only that the pull request does not say so; it does not mean that no AI tool was used.

## The three forms, strongest first

- **A trailer.** A line of any commit message whose key is one that [`data/tools.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/tools.yaml) lists as disclosing, such as `Assisted-by:` in any case; the list also holds misspellings of it and other keys seen in the data, such as `Claude-Session:`. A trailer counts on any commit of the pull request and anywhere in the message.
- **A co-author.** A trailer with the key `Co-authored-by:`, in any case, in a commit message, that gives a tool's own address (see [What is withheld](#privacy-what-is-withheld)) and somewhere in the line, the address included, uses a word the candidates are found by. The addresses of Claude Code, Copilot and Cursor's agent are such words themselves, so a line that gives one of them beside a person's name counts as a co-author disclosure, under the tool family its whole line matches (see [Tool families](#disclosure-tool-families)). IBM Bob's address, `bob@ibm.com`, is not such a word, so a line that gives it is read only when another candidate word, such as "IBM Bob", stands in it.
- **Disclosure phrasing** in the description or in the text of a commit message: a line that matches one of the phrases `data/tools.yaml` lists, such as "Generated with" or "with the help of" followed by a tool or an AI. A line that only names a tool, such as one about addressing Copilot's review comments, does not count.

Each line is judged on its own. A line is first kept as a candidate when it names a tool or uses words such as "assisted by"; the tables then decide whether it counts. A trailer in a commit message counts by its key: a disclosing key or `Co-authored-by`. A line of the description, or of a commit message's text, counts only when it matches a phrase. A candidate that its key or a phrase would otherwise count, or a trailer whose key the table does not list, is listed in the table's `ignore` section, with the reason, when it is judged not to be a disclosure. Comments and reviews are not read for disclosure.

On the data as of {{asOf}}, {{disclosure.disclosed}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months disclose AI use ({{disclosure.share}}).

{{table.disclosureForms}}

## Tool families

A counted line names the first tool family in `data/tools.yaml` whose pattern it matches anywhere in the line, a person's name included; the table lists tools before the models they run, so a tool and its model name the tool. A name can decide the family: IBM Bob's pattern matches the word "Bob", so a co-author line that gives a person called Bob with Claude Code's address counts under IBM Bob. A pull request counts under every family its counted lines name. "Unspecified" is a disclosure that names no tool, only an AI or an LLM, and a pull request is listed under it only when none of its disclosures names a tool. `cephstats check` fails on a counted line that matches no family, so every counted disclosure names one.

{{table.families}}

## Backports

A backport cherry-picks the original commits. When the cherry-pick keeps their messages, as `git cherry-pick` does, the trailers come with them, and the backport discloses whatever the original commits disclosed: its disclosure describes the original work. The backport's own description counts as well.

## What it cannot show

- **"AI use not disclosed" is not "no AI".** Disclosure is voluntary, and nothing on this site detects use that is not disclosed.
- **The two groups are not alike.** Pull requests that disclose and those that do not differ in size, kind, author and age, and either group can be dominated by a few authors. A difference between them does not show that AI use caused it.
- **Ceph's rule was a draft.** Ceph's rule asking for an `Assisted-by` trailer was a draft on 2026-10-12. On 2026-11-15 the tracker listed [the motion on that rule](https://tracker.ceph.com/issues/79745) as "Defeated".
- **A wrapped sentence can be missed.** Lines are judged one at a time, so a disclosure sentence wrapped across two lines can be missed when neither line counts alone. `data/tools.yaml` holds a phrase written for the second half of such a sentence seen in the data. `cephstats check --report` lists neighbouring candidate lines that match a phrase only when joined, so whoever edits the table can find others.
- **Wording outside the tables is missed.** A disclosure in words the candidate list or the phrases do not cover is not counted, and one in the description is read as it stands at the last fetch.
