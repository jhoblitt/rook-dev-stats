# Disclosure of AI use

A pull request discloses AI use when its commit messages or its description say so in one of four forms, and the strongest form it uses is the one it is counted under. A tool's name alone is not a disclosure. "Not disclosed" means only that the pull request does not say so; it does not mean that no AI tool was used.

rook/rook's [AI guidelines](https://github.com/rook/rook/blob/master/Documentation/Contributing/ai-guidelines.md), added on 2026-04-24, ask contributors to say in the pull request's description how AI tools assisted. Since 2026-07-27 they permit commit trailers that credit a tool, `Co-authored-by`, `Assisted-by` or `Generated-by`, without requiring them. The pull request template added a checklist line on the same day as the guidelines: "Reviewed AI guidelines, if AI assisted with the PR".

## The four forms, strongest first

- **A trailer.** A line of any commit message whose key is one that [`data/tools.yaml`](https://github.com/jhoblitt/rook-dev-stats/blob/main/data/tools.yaml) lists as disclosing: `Assisted-by:` and `Generated-by:`, which the guidelines permit, and `Claude-Session:`, a key seen in the data, each in any case. A trailer counts on any commit of the pull request and anywhere in the message.
- **A co-author.** A trailer with the key `Co-authored-by:`, in any case, in a commit message, that gives a tool's own address (see [What is withheld](#privacy-what-is-withheld)) and somewhere in the line, the address included, uses a word the candidates are found by. The addresses of Claude Code, Copilot and Cursor's agent are such words themselves, so a line that gives one of them beside a person's name counts as a co-author disclosure, under the tool family its whole line matches (see [Tool families](#disclosure-tool-families)). IBM Bob's address, `bob@ibm.com`, is not such a word, so a line that gives it is read only when another candidate word, such as "IBM Bob", stands in it.
- **Disclosure phrasing** in the description or in the text of a commit message: a line that matches one of the phrases `data/tools.yaml` lists, such as "Generated with" or "with the help of" followed by a tool or an AI, or a heading such as "AI disclosure:". A line that only names a tool, such as one about addressing Copilot's review comments, does not count.
- **The AI-guidelines box.** A description whose checklist line "Reviewed AI guidelines, if AI assisted with the PR" is ticked counts as a disclosure of AI use without naming a tool, so the pull request is listed under "Unspecified" unless another disclosure names one. A checklist line counts as the box when its label starts with "Reviewed" and holds "AI guidelines". An unticked box is not read at all, whatever it says. On a ticked box, the template's own wording, or a rewording such as "Reviewed the AI guidelines, when AI assisted", is never read as phrasing; words a contributor adds to it, such as how AI assisted, are read as phrasing like any other line of the description.

Each line is judged on its own. A line is first kept as a candidate when it names a tool or uses words such as "assisted by"; the tables then decide whether it counts. A trailer in a commit message counts by its key: a disclosing key or `Co-authored-by`. A line of the description, or of a commit message's text, counts only when it matches a phrase. A candidate that its key or a phrase would otherwise count, or a trailer whose key the table does not list, is listed in the table's `ignore` section, with the reason, when it is judged not to be a disclosure. Comments and reviews are not read for disclosure.

On the data as of {{asOf}}, {{disclosure.disclosed}} of the {{prs.active}} pull requests open at some point in the last {{const.recentMonths}} months disclose AI use ({{disclosure.share}}).

{{table.disclosureForms}}

## Tool families

A counted line names the first tool family in `data/tools.yaml` whose pattern it matches anywhere in the line, a person's name included; the table lists tools before the models they run, so a tool and its model name the tool. A name can decide the family: Claude's pattern matches the word "Claude", so a co-author line that gives a person called Claude with IBM Bob's address counts under Claude. A pull request counts under every family its counted lines name. "Unspecified" is a disclosure that names no tool, only AI in general, or the ticked AI-guidelines box, and a pull request is listed under it only when none of its disclosures names a tool. `rookstats check` fails on a counted line that matches no family, so every counted disclosure names one.

{{table.families}}

## Backports

A backport cherry-picks the original commits. When the cherry-pick keeps their messages, as `git cherry-pick` and Mergify do, the trailers come with them, and the backport discloses whatever the original commits disclosed: its disclosure describes the original work. The backport's own description counts as well, and Mergify copies the original's description into it, so a backport Mergify opened discloses in its description as the original did, the ticked AI-guidelines box included.

## What it cannot show

- **"AI use not disclosed" is not "no AI".** Disclosure is voluntary, and nothing on this site detects use that is not disclosed.
- **The two groups are not alike.** Pull requests that disclose and those that do not differ in size, kind, author and age, and either group can be dominated by a few authors. A difference between them does not show that AI use caused it.
- **Before 2026-04-24 nothing was asked.** rook/rook had no AI guidelines before then, and its template no box, so a disclosure from before then was volunteered.
- **The box is the weakest form.** It says that its author read the guidelines, and only if AI assisted, so a ticked box does not say that AI assisted, and an unticked one does not say that it did not. Some contributors tick every box of the checklist, whether or not it applies to them. It is counted because some pull requests carry no other mark, and under a form of its own, below every other. Only a pull request's timeline and the table of forms above tell it apart: the PR table, the "AI use disclosure" filter and the AI-use charts count it as disclosed, under "Unspecified".
- **A wrapped sentence can be missed.** Lines are judged one at a time, so a disclosure sentence wrapped across two lines can be missed when neither line counts alone. `rookstats check --report` lists neighbouring candidate lines that match a phrase only when joined, so whoever edits the table can find them.
- **Wording outside the tables is missed.** A disclosure in words the candidate list or the phrases do not cover is not counted, and one in the description is read as it stands at the last fetch.
