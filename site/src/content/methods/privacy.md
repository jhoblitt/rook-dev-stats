# What the data keeps about a person

The site and its published data identify people by GitHub login, and keep no e-mail address or profile on purpose, and no name but one: a pull request opened by an account since deleted is credited to a name on its commits ([Deleted accounts](#people-deleted-accounts)). Some text that contributors wrote is kept as written, and a name in it can still appear. This section says what is kept, what is withheld, and what can get through.

## What the page loads

About people, the page's data holds GitHub logins and the times of what they did: the author of each pull request, and who made each comment and each review by a person other than the author, bot commands aside, each with its time. For a pull request opened by an account since deleted, the author is the name it is credited to from its commits, where they give one, and otherwise GitHub's placeholder `ghost`, shown as "(deleted, unknown)". Beside each pull request's author it holds the author's count of earlier pull requests in rook/rook, where known, and whether and how the pull request discloses AI use, with the tool families named. It also holds the time of every other comment and review, without a login; the SHA, author time and committer time of every commit; and each pull request's title as written. It holds no comment text and none of the lines read for disclosure.

## What the repository's records keep

The page's data is built from records under `data/` in [the site's repository](https://github.com/jhoblitt/rook-dev-stats), which are public. They keep more:

- each account's login and whether GitHub types it as a bot; for a pull request's author, GitHub's author association, such as member or contributor; and in `data/authors.json`, each author's count of pull requests opened before the window's start, {{windowStart}}, which is none for anyone, since the repository was created that day;
- for a pull request opened by an account since deleted, the one name it is credited to from its commits, as [Deleted accounts](#people-deleted-accounts) says. The other names on its commits are read too, but kept only in the fetch's local cache, and a name that holds an `@` is not kept among them. The cache also keeps every commit message whole, whose `Signed-off-by:` lines give each signer's name and address;
- each pull request's title, and the lines of its description and commit messages that might disclose AI use, quoted as written and cut at 200 characters;
- for each issue GitHub links as closed by a pull request, its number, its repository and its labels, but not its text, its author or its comments. The data is read from GitHub alone: rook/rook tracks its work in GitHub's issues, and no other tracker is asked;
- the text of every comment that is a single line of at most 80 characters with no `@` in it, whatever it says, except that it may start with a mention of Mergify or Dependabot followed by white space, which names no person; this is how a bot command is recognised. The records keep the text of no other comment. The raw responses from GitHub, which keep every comment's text whole, are not published.

## What is withheld

A line that might disclose AI use is not kept when:

- it begins with the key of a trailer that names people or links, such as `Signed-off-by:`, `Reviewed-by:`, `Tested-by:`, `Reported-by:`, `Cc:` or `Fixes:`, written as a trailer: once white space of any kind at the ends of the line is trimmed, it starts with the key, in ASCII letters, digits and hyphens and in any case, followed directly by a colon and then by a space, a tab, a form feed, a carriage return or the end of the line. Whatever follows is not kept;
- it holds an e-mail address other than a known tool's, such as Claude Code's or Copilot's. An `@` counts as part of an address unless it starts a mention, and `%40` counts too;
- it holds the `Co-authored-by` key, in any case, with hyphens of any kind, underscores, spaces or tabs between its words, or nothing between "co" and "authored", unless the line has the shape of a tool's: the key appears once; the line holds exactly one address, and it is a tool's; the address comes after the key; nothing between the key and the address separates names (a comma, a semicolon, `&`, `/`, `+`, `|`, or the word "and" or "with"); and no letter or digit follows the address, apart from a closing HTML tag such as `</li>`. A line with the key and no address is not kept. Before the key, the line is searched only for addresses and for a second key, so a name there is not checked; nor is a name between the key and the address, beyond the separators above.

Some lines are withheld on purpose although they name no one, because they look like an address: a tool's name with a version after an `@`, written `name@version`, and a mention written straight after other text.

## What can still appear

The rules above read lines, not meaning. A person's name or address can still appear in the records:

- in a line that holds no `Co-authored-by` key and whose only addresses are tools', for example a description line that thanks someone by name and also mentions a tool;
- in a `Co-authored-by` line, before the key or in the place of the tool's name: a name there is not looked for, only addresses, a second key and the separators;
- in a line that starts with one of the never-kept keys written any other way, such as with nothing after the colon but text, a space before it, other white space after it (a non-breaking space or a vertical tab, say), a hyphen or colon that is not ASCII, an invisible character such as a zero-width space before the key or inside it, which is not white space and is not trimmed, or a list marker before the key, when the rest of the line makes it a candidate;
- in a trailer of another key that carries no address, such as an `Assisted-by` line that names a person beside a tool;
- as an address written so as not to look like one: with a space before the `@` and none after it, which reads as a mention; written out with "at"; or encoded other than as `%40`;
- as a mention of another person's login, such as one that thanks them, in a kept line;
- in a short comment's text, such as one that thanks someone, and in a pull request's title;
- in the name a deleted account's pull request is credited to, which is kept as its commits give it, but for white space, control and format characters, and the dropping of any name that holds an `@`: someone can have written there an address without an `@`, such as one written out with "at", or another person's name.

To ask for a line to be removed, open an issue on [the site's repository](https://github.com/jhoblitt/rook-dev-stats/issues) naming the pull request. There is no need to quote the line: issues are public.
