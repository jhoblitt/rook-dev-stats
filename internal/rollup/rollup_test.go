package rollup_test

import (
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
)

func event(at time.Time, kind string) record.Event { return record.Event{At: at, Kind: kind} }

func review(at time.Time, by, state string) record.Review {
	return record.Review{At: at, By: by, State: state}
}

func botReview(at time.Time, by, state string) record.Review {
	return record.Review{At: at, By: by, Bot: true, State: state}
}

func comment(at time.Time, by, text string) record.Comment {
	return record.Comment{At: at, By: by, Text: text}
}

func botComment(at time.Time, by, text string) record.Comment {
	return record.Comment{At: at, By: by, Bot: true, Text: text}
}

var _ = Describe("Build", func() {
	Describe("a pull request's columns", func() {
		DescribeTable("opened_draft and ready",
			func(draft bool, events []record.Event, openedDraft, ready int64) {
				r := pr(1)
				r.Draft = draft
				r.Events = events
				o := build(r)
				Expect(o.one("opened_draft")).To(Equal(openedDraft), "opened_draft")
				Expect(o.one("ready")).To(Equal(ready), "ready")
			},
			Entry("opened ready: ready at the opening", false, nil, int64(0), epoch(opened)),
			Entry("opened as a draft and marked ready: the first ready",
				false, []record.Event{event(h(5), record.KindReady), event(h(6), record.KindDraft), event(h(7), record.KindReady)},
				int64(1), epoch(h(5))),
			Entry("a lifecycle event before the first ready does not decide it",
				false, []record.Event{event(h(1), record.KindForcePush), event(h(4), record.KindReady)},
				int64(1), epoch(h(4))),
			Entry("a draft now with no draft or ready event: never ready", true, nil, int64(1), int64(-1)),
			Entry("converted to a draft after opening, a draft now: opened ready",
				true, []record.Event{event(h(2), record.KindDraft)}, int64(0), epoch(opened)),
			Entry("converted to a draft and back: opened ready",
				false, []record.Event{event(h(2), record.KindDraft), event(h(3), record.KindReady)}, int64(0), epoch(opened)),
		)

		DescribeTable("closed and reopened",
			func(state string, events []record.Event, closed, reopened int64) {
				r := pr(1)
				r.Updated = h(8)
				r.State = state
				r.Events = events
				o := build(r)
				Expect(o.one("closed")).To(Equal(closed), "closed")
				Expect(o.one("reopened")).To(Equal(reopened), "reopened")
			},
			Entry("open: none, even after a close and a reopening", record.StateOpen,
				[]record.Event{event(h(1), record.KindClosed), event(h(2), record.KindReopened)}, int64(-1), int64(1)),
			Entry("merged: the merge", record.StateMerged,
				[]record.Event{event(h(3), record.KindMerged), event(h(3), record.KindClosed)}, epoch(h(3)), int64(0)),
			Entry("closed unmerged: the close", record.StateClosed,
				[]record.Event{event(h(4), record.KindClosed)}, epoch(h(4)), int64(0)),
			Entry("closed, reopened twice and merged: the last", record.StateMerged,
				[]record.Event{
					event(h(1), record.KindClosed), event(h(2), record.KindReopened),
					event(h(3), record.KindClosed), event(h(4), record.KindReopened),
					event(h(5), record.KindMerged), event(h(5), record.KindClosed),
				}, epoch(h(5)), int64(2)),
			Entry("merged with no event recorded: the last update", record.StateMerged, nil, epoch(h(8)), int64(0)),
			Entry("closed with only a reopening recorded: the last update", record.StateClosed,
				[]record.Event{event(h(2), record.KindReopened)}, epoch(h(8)), int64(1)),
			Entry("open with no event recorded: none", record.StateOpen, nil, int64(-1), int64(0)),
		)

		DescribeTable("first_response",
			func(mutate func(*record.Record), want int64) {
				r := pr(1)
				mutate(&r)
				Expect(build(r).one("first_response")).To(Equal(want))
			},
			Entry("a comment by another person", func(r *record.Record) {
				r.Comments = []record.Comment{comment(h(3), "bob", "")}
			}, epoch(h(3))),
			Entry("a review by another person, earlier than a comment", func(r *record.Record) {
				r.Comments = []record.Comment{comment(h(3), "bob", "")}
				r.Reviews = []record.Review{review(h(2), "carol", record.ReviewCommented)}
			}, epoch(h(2))),
			Entry("not the author's comments and reviews, commands, bot accounts or bot reviews", func(r *record.Record) {
				r.Comments = []record.Comment{
					comment(h(1), "alice", "thanks"),
					comment(h(2), "bob", "jenkins test make check"),
					comment(h(3), "ci-runner", "looks good"),
					botComment(h(4), "ceph-bot", "build passed"),
					comment(h(9), "bob", "a real review comment"),
				}
				r.Reviews = []record.Review{
					review(h(5), "alice", record.ReviewCommented),
					botReview(h(6), "coderabbit", record.ReviewApproved),
					review(h(7), "ci-runner", record.ReviewCommented),
				}
			}, epoch(h(9))),
			Entry("before ready: written as ready", func(r *record.Record) {
				r.Events = []record.Event{event(h(5), record.KindReady)}
				r.Comments = []record.Comment{comment(h(2), "bob", "")}
			}, epoch(h(5))),
			Entry("before the opening: written as the opening", func(r *record.Record) {
				r.Comments = []record.Comment{comment(h(-2), "bob", "")}
			}, epoch(opened)),
			Entry("after the pull request closed: as recorded", func(r *record.Record) {
				r.State = record.StateClosed
				r.Events = []record.Event{event(h(2), record.KindClosed)}
				r.Comments = []record.Comment{comment(h(10), "bob", "")}
			}, epoch(h(10))),
			Entry("never ready: none", func(r *record.Record) {
				r.Draft = true
				r.Comments = []record.Comment{comment(h(3), "bob", "")}
			}, int64(-1)),
			Entry("no response: none", func(*record.Record) {}, int64(-1)),
			Entry("a ghost's comment on a ghost's pull request", func(r *record.Record) {
				r.Author = record.Actor{Login: fetch.GhostLogin}
				r.Comments = []record.Comment{comment(h(3), fetch.GhostLogin, "")}
			}, epoch(h(3))),
			Entry("a ghost's review on a ghost's pull request", func(r *record.Record) {
				r.Author = record.Actor{Login: fetch.GhostLogin}
				r.Reviews = []record.Review{review(h(4), fetch.GhostLogin, record.ReviewCommented)}
			}, epoch(h(4))),
			Entry("a dismissed review by another person", func(r *record.Record) {
				r.Reviews = []record.Review{review(h(4), "carol", record.ReviewDismissed)}
			}, epoch(h(4))),
		)

		DescribeTable("first_approval",
			func(mutate func(*record.Record), want int64) {
				r := pr(1)
				mutate(&r)
				Expect(build(r).one("first_approval")).To(Equal(want))
			},
			Entry("the earliest approval by another person", func(r *record.Record) {
				r.Reviews = []record.Review{
					review(h(2), "carol", record.ReviewChangesRequested),
					review(h(3), "carol", record.ReviewApproved),
					review(h(5), "dan", record.ReviewApproved),
				}
			}, epoch(h(3))),
			Entry("not the author's approval nor a bot's", func(r *record.Record) {
				r.Reviews = []record.Review{
					review(h(1), "alice", record.ReviewApproved),
					review(h(2), "ci-runner", record.ReviewApproved),
					botReview(h(3), "dependabot", record.ReviewApproved),
					review(h(4), "carol", record.ReviewCommented),
				}
			}, int64(-1)),
			Entry("before ready: written as ready", func(r *record.Record) {
				r.Events = []record.Event{event(h(5), record.KindReady)}
				r.Reviews = []record.Review{review(h(2), "carol", record.ReviewApproved)}
			}, epoch(h(5))),
			Entry("never ready: none", func(r *record.Record) {
				r.Draft = true
				r.Reviews = []record.Review{review(h(2), "carol", record.ReviewApproved)}
			}, int64(-1)),
			Entry("after a merge before ready: as recorded", func(r *record.Record) {
				r.State = record.StateMerged
				r.Events = []record.Event{event(h(1), record.KindMerged), event(h(4), record.KindReady)}
				r.Reviews = []record.Review{review(h(6), "carol", record.ReviewApproved)}
			}, epoch(h(6))),
		)

		DescribeTable("first_commit and last_commit",
			func(first, last *time.Time, wantFirst, wantLast int64) {
				r := pr(1)
				r.Commits = record.Commits{Count: 1, FirstAuthored: first, LastCommitted: last}
				o := build(r)
				Expect(o.one("first_commit")).To(Equal(wantFirst), "first_commit")
				Expect(o.one("last_commit")).To(Equal(wantLast), "last_commit")
			},
			Entry("authored before the opening", new(h(-30)), new(h(2)), epoch(h(-30)), epoch(h(2))),
			Entry("authored at the opening", new(opened), new(opened), epoch(opened), epoch(opened)),
			Entry("authored after the opening: history rewritten, unknown", new(h(1)), new(h(2)), int64(-1), epoch(h(2))),
			Entry("a last commit before the first: as recorded", new(h(-10)), new(h(-20)), epoch(h(-10)), epoch(h(-20))),
			Entry("a commit dated in the future: as recorded", new(h(-1)), new(h(24*365*4)), epoch(h(-1)), epoch(h(24*365*4))),
			Entry("no commits: unknown", nil, nil, int64(-1), int64(-1)),
		)

		DescribeTable("standing",
			func(prior *int, want int64) {
				r := pr(1)
				r.PriorPRs = prior
				Expect(build(r).one("standing")).To(Equal(want))
			},
			Entry("a first pull request", new(0), int64(0)),
			Entry("seven before", new(7), int64(7)),
			Entry("no baseline", nil, int64(-1)),
		)

		DescribeTable("in_window",
			func(created time.Time, want int64) {
				r := pr(1)
				r.Created = created
				Expect(build(r).one("in_window")).To(Equal(want))
			},
			Entry("opened at the window start", windowStart, int64(1)),
			Entry("opened a second before it", windowStart.Add(-time.Second), int64(0)),
		)

		It("counts human reviews, bot reviews and bot commands", func() {
			r := pr(1)
			r.Reviews = []record.Review{
				review(h(1), "carol", record.ReviewApproved),
				review(h(2), "alice", record.ReviewCommented),
				review(h(3), "dan", record.ReviewDismissed),
				botReview(h(4), "coderabbit", record.ReviewCommented),
				review(h(5), "ci-runner", record.ReviewApproved),
			}
			r.Comments = []record.Comment{
				comment(h(1), "alice", "jenkins test make check"),
				comment(h(2), "bob", "jenkins retest this please"),
				botComment(h(3), "ceph-bot", "jenkins test make check"),
				comment(h(4), "ci-runner", "jenkins test make check"),
				comment(h(5), "bob", "lgtm"),
			}
			o := build(r)
			Expect(o.one("human_reviews")).To(Equal(int64(2)), "human_reviews")
			Expect(o.one("bot_reviews")).To(Equal(int64(2)), "bot_reviews")
			Expect(o.one("bot_commands")).To(Equal(int64(2)), "bot_commands")
		})

		It("writes the author's own review as review_author, not a human review", func() {
			r := pr(1)
			r.Reviews = []record.Review{
				{At: h(1), ID: 201, By: "alice", State: record.ReviewCommented},
				{At: h(2), ID: 202, By: "carol", State: record.ReviewCommented},
			}
			o := build(r)
			Expect(o.one("human_reviews")).To(Equal(int64(1)))
			Expect(o.one("bot_reviews")).To(Equal(int64(0)))
			Expect(o.evs(2026)).To(Equal([]ev{
				{PR: 1, At: h(1), Kind: "review_author", Ref: "201"},
				{PR: 1, At: h(2), Kind: "review_commented", Actor: "carol", Ref: "202"},
			}))
			Expect(o.events(2026).Actor).To(Equal([]int{-1, 1}))
		})

		DescribeTable("a review by the author, whatever its verdict",
			func(state string) {
				r := pr(1)
				r.Reviews = []record.Review{{At: h(1), By: "alice", State: state}}
				o := build(r)
				Expect(o.evs(2026)).To(Equal([]ev{{PR: 1, At: h(1), Kind: "review_author"}}))
				Expect(o.one("human_reviews")).To(Equal(int64(0)))
				Expect(o.one("first_response")).To(Equal(int64(-1)))
				Expect(o.one("first_approval")).To(Equal(int64(-1)))
			},
			Entry("approved", record.ReviewApproved),
			Entry("changes requested", record.ReviewChangesRequested),
			Entry("dismissed", record.ReviewDismissed),
		)

		It("writes a bot author's own review as a bot review", func() {
			r := pr(1)
			r.Author = record.Actor{Login: "dependabot", Bot: true}
			r.Reviews = []record.Review{{At: h(1), By: "dependabot", Bot: true, State: record.ReviewCommented}}
			o := build(r)
			Expect(o.evs(2026)).To(Equal([]ev{{PR: 1, At: h(1), Kind: "bot_review"}}))
			Expect(o.one("bot_reviews")).To(Equal(int64(1)))
		})

		It("indexes state and base, and copies the sizes and flags", func() {
			a, b, c := pr(1), pr(2), pr(3)
			a.Base, a.Additions, a.Deletions, a.Files, a.Commits.Count = "squid", 10, 2, 3, 4
			b.Base, b.State, b.Draft = "main", record.StateMerged, true
			c.Base, c.State = "reef", record.StateClosed
			o := build(c, a, b)
			Expect(o.meta().Bases).To(Equal([]string{"main", "reef", "squid"}))
			Expect(o.col(2026, "number")).To(Equal([]int64{1, 2, 3}))
			Expect(o.col(2026, "created")).To(Equal([]int64{epoch(opened), epoch(opened), epoch(opened)}))
			Expect(o.col(2026, "base")).To(Equal([]int64{2, 0, 1}))
			Expect(o.col(2026, "state")).To(Equal([]int64{0, 1, 2}))
			Expect(o.col(2026, "draft")).To(Equal([]int64{0, 1, 0}))
			Expect(o.col(2026, "additions")).To(Equal([]int64{10, 0, 0}))
			Expect(o.col(2026, "deletions")).To(Equal([]int64{2, 0, 0}))
			Expect(o.col(2026, "files")).To(Equal([]int64{3, 0, 0}))
			Expect(o.col(2026, "commits")).To(Equal([]int64{4, 0, 0}))
		})

		It("is an error naming the pull request for a state it does not know", func() {
			r := pr(42)
			r.State = "locked"
			in := loadInput()
			in.Records = []record.Record{r}
			_, err := rollup.Build(in)
			Expect(err).To(MatchError(And(ContainSubstring("42"), ContainSubstring(`"locked"`))))
		})

		DescribeTable("is an error naming the pull request for a lifecycle event kind a record does not hold",
			func(kind string) {
				r := pr(42)
				r.Events = []record.Event{event(h(1), kind)}
				in := loadInput()
				in.Records = []record.Record{r}
				_, err := rollup.Build(in)
				Expect(err).To(MatchError(And(ContainSubstring("42"), ContainSubstring(`"`+kind+`"`))))
			},
			Entry("one the site does not know", "locked"),
			Entry("a comment's kind, which the site knows", "comment_other"),
			Entry("a review's kind", "review_approved"),
		)

		It("is an error naming the pull request for a review state it does not know", func() {
			r := pr(42)
			r.Reviews = []record.Review{review(h(1), "carol", "pending")}
			in := loadInput()
			in.Records = []record.Record{r}
			_, err := rollup.Build(in)
			Expect(err).To(MatchError(And(ContainSubstring("42"), ContainSubstring(`"pending"`))))
		})

		It("indexes the disclosure, its families and the components, lists ascending", func() {
			r := pr(1)
			r.Labels = []string{"cephfs", "rgw", "needs-review"}
			r.Disclosure = record.Disclosure{
				Trailers:    []string{"Assisted-by: Claude Code"},
				Description: []string{"Generated with Copilot"},
				CommitProse: []string{},
			}
			o := build(r)
			Expect(o.meta().Disclosure).To(Equal([]string{"none", "description", "coauthor", "trailer"}))
			Expect(o.one("disclosure")).To(Equal(int64(3)))
			Expect(o.lists(2026, "families")).To(Equal([][]int{{0, 1}}))
			Expect(o.lists(2026, "components")).To(Equal([][]int{{0, 2}}))
		})

		It("writes empty lists, not null, for no family and no component", func() {
			o := build(pr(1))
			Expect(o.one("disclosure")).To(Equal(int64(0)))
			Expect(string(o.prs(2026)["families"])).To(Equal("[[]]"))
			Expect(string(o.prs(2026)["components"])).To(Equal("[[]]"))
		})

		DescribeTable("kind and kind_source",
			func(hints *record.KindHints, labels []string, kind int64, source string) {
				r := pr(1)
				r.KindHints = hints
				r.Labels = labels
				o := build(r)
				Expect(o.one("kind")).To(Equal(kind), "kind")
				Expect(o.table(2026).KindSource).To(Equal([]string{source}), "kind_source")
			},
			Entry("from the checklist", &record.KindHints{Checklist: []string{record.CheckNewFeature}}, []string{}, int64(1), "checklist"),
			Entry("from a ticket", &record.KindHints{Tickets: []int{90002}}, []string{}, int64(0), "tracker"),
			Entry("from a label", nil, []string{"cleanup"}, int64(2), "labels"),
			Entry("unknown: -1 and no source", nil, []string{}, int64(-1), ""),
		)

		It("takes a backport's kind from its original, with its tickets and backport_of", func() {
			orig, bp := pr(1), pr(2)
			orig.KindHints = &record.KindHints{Checklist: []string{record.CheckDocUpdate}}
			bp.Base = "squid"
			bp.KindHints = &record.KindHints{Tickets: []int{90002, 90001}, BackportOf: 1}
			o := build(orig, bp)
			Expect(o.col(2026, "kind")).To(Equal([]int64{3, 3}))
			t := o.table(2026)
			Expect(t.KindSource).To(Equal([]string{"checklist", "original"}))
			Expect(t.Tickets).To(Equal([][]int{{}, {90002, 90001}}))
			Expect(t.BackportOf).To(Equal([]int{0, 1}))
		})

		DescribeTable("backport_link: whether the description links the pull request it backports",
			func(hints *record.KindHints, want int64) {
				r := pr(2)
				r.Base = "squid"
				r.KindHints = hints
				Expect(build(r).one("backport_link")).To(Equal(want))
			},
			Entry("a link to one in the data", &record.KindHints{BackportOf: 1}, int64(1)),
			Entry("a link to one not in the data", &record.KindHints{BackportOf: 99999}, int64(1)),
			Entry("hints with no link", &record.KindHints{Tickets: []int{90002}}, int64(0)),
			Entry("no hints", nil, int64(0)),
			Entry("a link that is not a pull request number", &record.KindHints{BackportOf: -1}, int64(0)),
		)
	})

	Describe("events", func() {
		It("writes every comment, review and lifecycle event by time, with its command and person", func() {
			r := pr(1)
			r.State = record.StateMerged
			r.Events = []record.Event{
				{At: h(2), Kind: record.KindReady, ID: 101},
				{At: h(9), Kind: record.KindMerged, ID: 102, SHA: "c0ffee0000000000000000000000000000000001"},
				{At: h(9), Kind: record.KindClosed, ID: 103},
			}
			r.Reviews = []record.Review{
				{At: h(3), ID: 201, By: "carol", State: record.ReviewChangesRequested},
				{At: h(5), ID: 202, By: "alice", State: record.ReviewCommented},
				{At: h(6), ID: 203, By: "coderabbit", Bot: true, State: record.ReviewApproved},
				{At: h(7), ID: 204, By: "carol", State: record.ReviewApproved},
				{At: h(8), ID: 205, By: "dan", State: record.ReviewDismissed},
			}
			r.Comments = []record.Comment{
				{At: h(1), ID: 301, By: "bob"},
				{At: h(4), ID: 302, By: "alice", Text: "jenkins test make check"},
				{At: h(4), ID: 303, By: "bob", Text: "jenkins retest this please"},
				{At: h(6), ID: 304, By: "ci-runner", Text: "jenkins test make check"},
				{At: h(8), ID: 305, By: "alice", Text: "thanks"},
			}
			Expect(build(r).evs(2026)).To(Equal([]ev{
				{PR: 1, At: h(1), Kind: "comment_other", Actor: "bob", Ref: "301"},
				{PR: 1, At: h(2), Kind: "ready", Ref: "101"},
				{PR: 1, At: h(3), Kind: "review_changes", Actor: "carol", Ref: "201"},
				{PR: 1, At: h(4), Kind: "command_author", Sub: "make-check", Ref: "302"},
				{PR: 1, At: h(4), Kind: "command_other", Sub: "retest", Ref: "303"},
				{PR: 1, At: h(5), Kind: "review_author", Ref: "202"},
				{PR: 1, At: h(6), Kind: "bot_account", Ref: "304"},
				{PR: 1, At: h(6), Kind: "bot_review", Ref: "203"},
				{PR: 1, At: h(7), Kind: "review_approved", Actor: "carol", Ref: "204"},
				{PR: 1, At: h(8), Kind: "comment_author", Ref: "305"},
				{PR: 1, At: h(8), Kind: "review_commented", Actor: "dan", Ref: "205"},
				{PR: 1, At: h(9), Kind: "merged", Ref: "c0ffee0000000000000000000000000000000001"},
			}))
		})

		DescribeTable("leaves out only the close a merge causes, up to five seconds after it",
			func(events []record.Event, want []ev) {
				r := pr(1)
				r.State = record.StateMerged
				r.Events = events
				Expect(build(r).evs(2026)).To(Equal(want))
			},
			Entry("a close at the second of the merge: left out",
				[]record.Event{{At: h(3), Kind: record.KindMerged}, {At: h(3), Kind: record.KindClosed, ID: 12}},
				[]ev{{PR: 1, At: h(3), Kind: "merged"}}),
			Entry("a close a second after the merge: left out",
				[]record.Event{{At: h(3), Kind: record.KindMerged}, {At: h(3).Add(time.Second), Kind: record.KindClosed, ID: 12}},
				[]ev{{PR: 1, At: h(3), Kind: "merged"}}),
			Entry("a close five seconds after the merge: left out",
				[]record.Event{{At: h(3), Kind: record.KindMerged}, {At: h(3).Add(5 * time.Second), Kind: record.KindClosed, ID: 12}},
				[]ev{{PR: 1, At: h(3), Kind: "merged"}}),
			Entry("a close six seconds after the merge: kept",
				[]record.Event{{At: h(3), Kind: record.KindMerged}, {At: h(3).Add(6 * time.Second), Kind: record.KindClosed, ID: 12}},
				[]ev{{PR: 1, At: h(3), Kind: "merged"}, {PR: 1, At: h(3).Add(6 * time.Second), Kind: "closed", Ref: "12"}}),
			Entry("a close before the merge, then reopened: kept",
				[]record.Event{
					{At: h(1), Kind: record.KindClosed, ID: 11},
					{At: h(2), Kind: record.KindReopened},
					{At: h(3), Kind: record.KindMerged},
					{At: h(3).Add(time.Second), Kind: record.KindClosed, ID: 12},
				},
				[]ev{{PR: 1, At: h(1), Kind: "closed", Ref: "11"}, {PR: 1, At: h(2), Kind: "reopened"}, {PR: 1, At: h(3), Kind: "merged"}}),
			Entry("a close a second before the merge: kept",
				[]record.Event{{At: h(3).Add(-time.Second), Kind: record.KindClosed, ID: 11}, {At: h(3), Kind: record.KindMerged}},
				[]ev{{PR: 1, At: h(3).Add(-time.Second), Kind: "closed", Ref: "11"}, {PR: 1, At: h(3), Kind: "merged"}}),
			Entry("merged, then reopened and closed again long after: the later close kept",
				[]record.Event{
					{At: h(3), Kind: record.KindMerged},
					{At: h(3).Add(time.Second), Kind: record.KindClosed, ID: 12},
					{At: h(20), Kind: record.KindReopened},
					{At: h(21), Kind: record.KindClosed, ID: 13},
				},
				[]ev{{PR: 1, At: h(3), Kind: "merged"}, {PR: 1, At: h(20), Kind: "reopened"}, {PR: 1, At: h(21), Kind: "closed", Ref: "13"}}),
		)

		DescribeTable("a merged pull request with no merge event",
			func(state string, events []record.Event, want []ev, closed, reopened int64) {
				r := pr(1)
				r.State = state
				r.Updated = h(30)
				r.Events = events
				o := build(r)
				Expect(o.evs(2026)).To(Equal(want))
				Expect(o.one("closed")).To(Equal(closed), "closed")
				Expect(o.one("reopened")).To(Equal(reopened), "reopened")
				Expect(o.col(2026, "state")).To(Equal([]int64{map[string]int64{
					record.StateOpen: 0, record.StateMerged: 1, record.StateClosed: 2,
				}[state]}), "state")
			},
			Entry("its only close: written as the merge, with no ref", record.StateMerged,
				[]record.Event{{At: h(2), Kind: record.KindForcePush}, {At: h(5), Kind: record.KindClosed, ID: 11}},
				[]ev{{PR: 1, At: h(2), Kind: "force_push"}, {PR: 1, At: h(5), Kind: "merged"}},
				epoch(h(5)), int64(0)),
			Entry("closed, reopened and closed: only the last close is the merge", record.StateMerged,
				[]record.Event{
					{At: h(1), Kind: record.KindClosed, ID: 11},
					{At: h(2), Kind: record.KindReopened},
					{At: h(5), Kind: record.KindClosed, ID: 12},
				},
				[]ev{{PR: 1, At: h(1), Kind: "closed", Ref: "11"}, {PR: 1, At: h(2), Kind: "reopened"}, {PR: 1, At: h(5), Kind: "merged"}},
				epoch(h(5)), int64(1)),
			Entry("the latest close, whatever the events' order", record.StateMerged,
				[]record.Event{{At: h(5), Kind: record.KindClosed, ID: 12}, {At: h(1), Kind: record.KindClosed, ID: 11}},
				[]ev{{PR: 1, At: h(1), Kind: "closed", Ref: "11"}, {PR: 1, At: h(5), Kind: "merged"}},
				epoch(h(5)), int64(0)),
			Entry("no close either: nothing written", record.StateMerged, []record.Event{}, []ev{}, epoch(h(30)), int64(0)),
			Entry("closed unmerged: the close stays a close", record.StateClosed,
				[]record.Event{{At: h(5), Kind: record.KindClosed, ID: 11}},
				[]ev{{PR: 1, At: h(5), Kind: "closed", Ref: "11"}},
				epoch(h(5)), int64(0)),
			Entry("open after a close: the close stays a close", record.StateOpen,
				[]record.Event{{At: h(1), Kind: record.KindClosed, ID: 11}, {At: h(2), Kind: record.KindReopened}},
				[]ev{{PR: 1, At: h(1), Kind: "closed", Ref: "11"}, {PR: 1, At: h(2), Kind: "reopened"}},
				int64(-1), int64(1)),
		)

		It("sorts by row, then time, across pull requests given out of order", func() {
			a, b := pr(2), pr(1)
			a.Comments = []record.Comment{{At: h(1), ID: 21, By: "bob"}}
			b.Comments = []record.Comment{{At: h(3), ID: 12, By: "bob"}, {At: h(2), ID: 11, By: "carol"}}
			e := build(a, b).events(2026)
			Expect(e.PR).To(Equal([]int{0, 0, 1}))
			Expect(e.At).To(Equal([]int64{epoch(h(2)), epoch(h(3)), epoch(h(1))}))
		})

		DescribeTable("an event's ref",
			func(r record.Record, want string) {
				e := build(r).evs(2026)
				Expect(e).To(HaveLen(1))
				Expect(e[0].Ref).To(Equal(want))
			},
			Entry("a comment: its id", withComment(record.Comment{At: h(1), ID: 4854682435, By: "bob"}), "4854682435"),
			Entry("a comment without an id: none", withComment(record.Comment{At: h(1), By: "bob"}), ""),
			Entry("a review: its id", withReview(record.Review{At: h(1), ID: 3412345678, By: "bob", State: record.ReviewApproved}), "3412345678"),
			Entry("ready: the event id", withEvent(record.Event{At: h(1), Kind: record.KindReady, ID: 28644873432}), "28644873432"),
			Entry("draft: the event id", withEvent(record.Event{At: h(1), Kind: record.KindDraft, ID: 28644873433}), "28644873433"),
			Entry("closed: the event id", withEvent(record.Event{At: h(1), Kind: record.KindClosed, ID: 28644873434}), "28644873434"),
			Entry("closed without an id: none", withEvent(record.Event{At: h(1), Kind: record.KindClosed}), ""),
			Entry("merged: the SHA, not the id",
				withEvent(record.Event{At: h(1), Kind: record.KindMerged, ID: 5, SHA: "4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70"}),
				"4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70"),
			Entry("merged with an upper-case SHA: none",
				withEvent(record.Event{At: h(1), Kind: record.KindMerged, ID: 5, SHA: "4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E6F70"}), ""),
			Entry("a force-push: the SHA",
				withEvent(record.Event{At: h(1), Kind: record.KindForcePush, SHA: "8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"}),
				"8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"),
			Entry("a force-push with a short SHA: none", withEvent(record.Event{At: h(1), Kind: record.KindForcePush, SHA: "8b2d4f6"}), ""),
			Entry("a force-push GitHub no longer shows: none", withEvent(record.Event{At: h(1), Kind: record.KindForcePush}), ""),
			Entry("a reopening: none", withEvent(record.Event{At: h(1), Kind: record.KindReopened}), ""),
		)
	})

	Describe("the table", func() {
		It("lists each commit with a valid SHA as [sha, authored, committed]", func() {
			r := pr(1)
			r.Commits = record.Commits{Count: 4, List: []record.Commit{
				{SHA: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", Authored: h(-5), Committed: h(-1)},
				{Authored: h(-4), Committed: h(-1)},
				{SHA: "2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E", Authored: h(-3), Committed: h(-1)},
				{SHA: "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f", Authored: h(-2), Committed: h(1)},
			}}
			Expect(build(r).table(2026).Commits).To(Equal([][]commitJSON{{
				{SHA: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", Authored: epoch(h(-5)), Committed: epoch(h(-1))},
				{SHA: "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f", Authored: epoch(h(-2)), Committed: epoch(h(1))},
			}}))
		})

		It("writes an empty list for a record written before commits were listed", func() {
			Expect(string(build(pr(1))["table-2026.json"])).To(ContainSubstring(`"commits":[[]]`))
		})

		It("carries titles and authors as written", func() {
			r := pr(1)
			r.Title = `rgw: fix a <leak> & a "race"`
			r.Author = record.Actor{Login: "Alice-Example"}
			t := build(r).table(2026)
			Expect(t.Titles).To(Equal([]string{`rgw: fix a <leak> & a "race"`}))
			Expect(t.Authors).To(Equal([]string{"Alice-Example"}))
		})
	})

	Describe("people", func() {
		It("indexes authors and actors by first appearance over the records in number order", func() {
			a, b, c := pr(3), pr(1), pr(2)
			a.Created = time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC)
			a.State, a.Updated = record.StateClosed, time.Date(2025, 12, 2, 0, 0, 0, 0, time.UTC)
			a.Author = record.Actor{Login: "carol"}
			a.Comments = []record.Comment{{At: h(1), By: "alice"}, {At: h(2), By: "erin"}}
			b.Author = record.Actor{Login: "bob"}
			b.Comments = []record.Comment{
				{At: h(5), By: "dan"},
				{At: h(3), By: "frank", Text: "jenkins test make check"},
				{At: h(4), By: "alice"},
			}
			b.Reviews = []record.Review{{At: h(6), By: "bob", State: record.ReviewCommented}}
			c.Author = record.Actor{Login: "dan"}
			c.Reviews = []record.Review{{At: h(1), By: "carol", State: record.ReviewApproved}}
			o := build(a, b, c)
			m := o.meta()
			Expect(m.People).To(Equal([]string{"bob", "alice", "dan", "carol", "erin"}))
			Expect(o.col(2026, "author")).To(Equal([]int64{0, 2}))
			Expect(o.col(2025, "author")).To(Equal([]int64{3}))
			Expect(o.events(2026).Actor).To(Equal([]int{-1, 1, 2, -1, 3}))
			Expect(o.events(2025).Actor).To(Equal([]int{1, 4}))
		})

		It("lists the bot accounts among them", func() {
			a, b, c := pr(1), pr(2), pr(3)
			a.Author = record.Actor{Login: "dependabot", Bot: true}
			b.Author = record.Actor{Login: "ci-runner"}
			c.Comments = []record.Comment{{At: h(1), By: "bob"}}
			m := build(a, b, c).meta()
			Expect(m.People).To(Equal([]string{"dependabot", "ci-runner", "alice", "bob"}))
			Expect(m.PeopleBots).To(Equal([]int{0, 1}))
		})

		It("indexes a named deleted account's pull request under ghost: and its name, lists it as deleted, and keeps the pooled ghost for every other", func() {
			ivy := record.Actor{Login: fetch.GhostLogin, Name: "Ivy Example"}
			a, b, c, d, e := pr(1), pr(2), pr(3), pr(4), pr(5)
			a.Author = ivy
			a.Comments = []record.Comment{{At: h(1), By: fetch.GhostLogin}}
			a.Reviews = []record.Review{{At: h(2), By: fetch.GhostLogin, State: record.ReviewApproved}}
			b.Author = record.Actor{Login: fetch.GhostLogin}
			c.Author = ivy
			d.Author = record.Actor{Login: fetch.GhostLogin, Name: "Kim Example"}
			e.Author = record.Actor{Login: "alice", Name: "Not Kept"}
			e.Comments = []record.Comment{{At: h(1), By: fetch.GhostLogin}}
			o := build(e, d, c, b, a)
			m := o.meta()
			Expect(m.People).To(Equal([]string{"ghost:Ivy Example", "ghost", "ghost:Kim Example", "alice"}))
			Expect(m.PeopleDeleted).To(Equal([]int{0, 2}))
			Expect(m.PeopleBots).To(BeEmpty())
			Expect(o.col(2026, "author")).To(Equal([]int64{0, 1, 0, 2, 3}))
			Expect(o.evs(2026)).To(Equal([]ev{
				{PR: 1, At: h(1), Kind: "comment_other", Actor: "ghost"},
				{PR: 1, At: h(2), Kind: "review_approved", Actor: "ghost"},
				{PR: 5, At: h(1), Kind: "comment_other", Actor: "ghost"},
			}), "a deleted account's comment and review on its own pull request are the pooled ghost's")
			Expect(o.table(2026).Authors).To(Equal([]string{"ghost", "ghost", "ghost", "ghost", "alice"}))
		})

		It("never lists a deleted account's entry among the bots", func() {
			a, b := pr(1), pr(2)
			a.Author = record.Actor{Login: fetch.GhostLogin, Bot: true, Name: "Ivy Example"}
			b.Author = record.Actor{Login: "dependabot", Bot: true}
			m := build(a, b).meta()
			Expect(m.People).To(Equal([]string{"ghost:Ivy Example", "dependabot"}))
			Expect(m.PeopleBots).To(Equal([]int{1}))
			Expect(m.PeopleDeleted).To(Equal([]int{0}))
		})

		It("writes an empty people_deleted when no deleted account is named", func() {
			r := pr(1)
			r.Author = record.Actor{Login: fetch.GhostLogin}
			o := build(r)
			Expect(o.meta().People).To(Equal([]string{"ghost"}))
			Expect(string(o["meta.json"])).To(HaveSuffix(`"people":["ghost"],"people_bots":[],"people_deleted":[]}`))
		})
	})

	Describe("meta.json", func() {
		It("carries the window, the years and every dictionary", func() {
			old := pr(1)
			old.Created = time.Date(2025, 11, 3, 0, 0, 0, 0, time.UTC)
			old.State, old.Updated = record.StateMerged, time.Date(2025, 11, 4, 0, 0, 0, 0, time.UTC)
			m := build(pr(2), old).meta()
			Expect(m.Repo).To(Equal("ceph/ceph"))
			Expect(m.WindowStart).To(Equal(epoch(windowStart)))
			Expect(m.FetchedThrough).To(Equal(epoch(fetchedThrough)))
			Expect(m.Years).To(Equal([]int{2025, 2026}))
			Expect(m.Components).To(Equal([]named{{"cephfs", "CephFS"}, {"rbd", "RBD"}, {"rgw", "RGW"}}))
			Expect(m.Families).To(Equal([]named{{"claude", "Claude"}, {"copilot", "GitHub Copilot"}, {"unspecified", "unspecified"}}))
			Expect(m.Commands).To(Equal([]named{{"make-check", "jenkins test make check"}, {"retest", "jenkins retest this please"}}))
			Expect(m.Kinds).To(Equal([]named{
				{"bugfix", "Bug fix"}, {"feature", "Feature"}, {"cleanup", "Cleanup"}, {"docs", "Documentation"}, {"other", "Other"},
			}))
			Expect(m.EventKinds).To(Equal([]string{
				"comment_other", "comment_author", "command_author", "command_other", "bot_account",
				"review_approved", "review_changes", "review_commented", "bot_review", "review_author",
				"ready", "draft", "force_push", "closed", "reopened", "merged",
			}))
		})

		It("writes a valid empty dataset when there are no records", func() {
			o := build()
			Expect(o).To(HaveLen(2))
			Expect(string(o["index.json"])).To(Equal(`{"numbers":[],"years":[]}`))
			m := o.meta()
			Expect(m.Years).To(BeEmpty())
			Expect(string(o["meta.json"])).To(ContainSubstring(`"years":[]`))
			Expect(string(o["meta.json"])).To(ContainSubstring(`"bases":[]`))
			Expect(string(o["meta.json"])).To(ContainSubstring(`"people":[],"people_bots":[],"people_deleted":[]`))
		})

		It("falls back to the window start and the latest update without meta.json", func() {
			r := pr(1)
			r.Updated = h(30)
			in := loadInput()
			in.Records, in.Meta = []record.Record{r}, nil
			m := buildInput(in).meta()
			Expect(m.Repo).To(Equal("rook/rook"))
			Expect(m.WindowStart).To(Equal(epoch(fetch.WindowStart)))
			Expect(m.FetchedThrough).To(Equal(epoch(h(30))))
		})

		It("files an open pull request without meta.json under the year of the latest update", func() {
			open, late := pr(1), pr(2)
			open.Created = at(2024, time.March, 1, 0, 0, 0)
			open.Updated = at(2024, time.March, 2, 0, 0, 0)
			late.State = record.StateClosed
			late.Created = at(2027, time.January, 2, 0, 0, 0)
			late.Updated = at(2027, time.January, 3, 0, 0, 0)
			late.Events = []record.Event{event(at(2027, time.January, 3, 0, 0, 0), record.KindClosed)}
			in := loadInput()
			in.Records, in.Meta = []record.Record{open, late}, nil
			o := buildInput(in)
			Expect(o.meta().Years).To(Equal([]int{2027}))
			Expect(o.fileYear(1)).To(Equal(2027))
			Expect(o.yearOf(1)).To(Equal(2027))
		})

		It("dates an empty dataset without meta.json at the window start", func() {
			in := loadInput()
			in.Records, in.Meta = nil, nil
			m := buildInput(in).meta()
			Expect(m.FetchedThrough).To(Equal(epoch(fetch.WindowStart)))
		})
	})
})

func withComment(c record.Comment) record.Record {
	r := pr(1)
	r.Comments = []record.Comment{c}
	return r
}

func withReview(rv record.Review) record.Record {
	r := pr(1)
	r.Reviews = []record.Review{rv}
	return r
}

func withEvent(e record.Event) record.Record {
	r := pr(1)
	r.Events = []record.Event{e}
	return r
}
