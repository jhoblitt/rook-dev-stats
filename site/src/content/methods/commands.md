# Bot commands

A bot command is a comment whose whole text is an instruction to automation, such as `jenkins test make check` or `/audit retest`, matched against the patterns in [`data/commands.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/commands.yaml). Bot commands are counted as their own category: a bot command is never a response and never a review.

## What makes a comment a command

- The comment's whole text, ignoring case and the space around it, must match one of the patterns. The first pattern that matches, top to bottom, names the command.
- Only a comment that is a single line of at most 80 characters with no `@` in it, but a leading mention of Mergify or Dependabot, can be a command, because only such a comment's text is kept (see [What the data keeps about a person](#privacy)). A command followed by a sentence, or spread over two lines, is an ordinary comment.
- A command by the pull request's author and one by another person are told apart. A comment from a bot account is a bot comment even when it reads like a command.

On the data as of {{asOf}}: of the {{comments.total}} conversation comments made during the last {{const.recentMonths}} months on the pull requests open at some point in them, {{comments.commands}} ({{comments.commandShare}}) were bot commands, {{comments.commandsByAuthor}} of them by the pull request's own author, and {{comments.botAccount}} came from bot accounts.

## What it cannot show

The list of patterns is edited by hand. A command it does not list is an ordinary comment, and so a response when someone other than the author makes it. `cephstats check --report` lists the short comments by people that match no pattern, so that whoever edits the list can see what it misses.
