# Bot commands

A bot command is a comment whose whole text is an instruction to automation, matched against the patterns in [`data/commands.yaml`](https://github.com/jhoblitt/rook-dev-stats/blob/main/data/commands.yaml). Most are addressed to Mergify, rook/rook's backport and merge-queue bot, such as `@mergifyio rebase` or `@mergifyio backport release-1.21`, or to Dependabot, which opens its dependency updates, such as `@dependabot rebase`. The table also lists requests to the Jenkins CI of rook/rook's early years, such as `ok to test`, and requests in the style of other projects' bots, such as `/retest`, which count as commands though nothing in rook/rook acts on them. rook/rook starts its optional CI suites with labels, not comments, so no command starts them. Bot commands are counted as their own category: a bot command is never a response and never a review.

## What makes a comment a command

- The comment's whole text, ignoring case and the space around it, must match one of the patterns. The first pattern that matches, top to bottom, names the command.
- Only a comment that is a single line of at most 80 characters, with no `@` in it other than in a mention of Mergify or Dependabot that starts it and is followed by white space, can be a command, because only such a comment's text is kept (see [What the data keeps about a person](#privacy)). A command followed by a sentence, or spread over two lines, is an ordinary comment.
- A command by the pull request's author and one by another person are told apart. A comment from a bot account is a bot comment even when it reads like a command.

On the data as of {{asOf}}: of the {{comments.total}} conversation comments made during the last {{const.recentMonths}} months on the pull requests open at some point in them, {{comments.commands}} ({{comments.commandShare}}) were bot commands, {{comments.commandsByAuthor}} of them by the pull request's own author, and {{comments.botAccount}} came from bot accounts.

## What it cannot show

The list of patterns is edited by hand. A command it does not list is an ordinary comment, and so a response when someone other than the author makes it. `rookstats check --report` lists the short comments by people that match no pattern, so that whoever edits the list can see what it misses.
