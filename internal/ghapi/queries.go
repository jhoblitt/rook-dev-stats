package ghapi

import (
	"fmt"
	"strings"
)

// Connection names one of a pull request's nested connections that the
// walk pages to the end.
type Connection string

// The nested connections, by their GraphQL field names.
const (
	Labels        Connection = "labels"
	Commits       Connection = "commits"
	Comments      Connection = "comments"
	Reviews       Connection = "reviews"
	TimelineItems Connection = "timelineItems"
)

// Connections lists every nested connection in the order queries select
// them.
var Connections = []Connection{Labels, Commits, Comments, Reviews, TimelineItems}

const rateLimitFields = `rateLimit { cost remaining resetAt }`

const pullRequestFields = `number title body state isDraft createdAt updatedAt closedAt mergedAt
      baseRefName additions deletions changedFiles authorAssociation
      author { login __typename }
      closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } labels(first: 20) { nodes { name } } } }`

const actorFields = `author { login __typename }`

// connectionArgs and connectionNodes hold what each connection selects
// beyond first and after.
var (
	connectionArgs = map[Connection]string{
		TimelineItems: `itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, CLOSED_EVENT, REOPENED_EVENT, MERGED_EVENT]`,
	}
	connectionNodes = map[Connection]string{
		Labels:  `name`,
		Commits: `commit { oid authoredDate committedDate message }`,
		// databaseId is deprecated for 64-bit ids; fullDatabaseId is a
		// BigInt, which GitHub sends as a JSON string.
		Comments: `fullDatabaseId createdAt body ` + actorFields,
		Reviews:  `fullDatabaseId submittedAt state ` + actorFields,
		// createdAt lives on each event type, so each needs its own
		// fragment. ReopenedEvent has no url: asking for one is an error.
		TimelineItems: `__typename
          ... on ReadyForReviewEvent { createdAt url }
          ... on ConvertToDraftEvent { createdAt url }
          ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } }
          ... on ClosedEvent { createdAt url }
          ... on ReopenedEvent { createdAt }
          ... on MergedEvent { createdAt url commit { oid } }`,
	}
)

func connectionSelection(c Connection, first, after string) string {
	args := "first: " + first
	if after != "" {
		args += ", after: " + after
	}
	if extra := connectionArgs[c]; extra != "" {
		args += ", " + extra
	}
	return fmt.Sprintf("%s(%s) {\n        pageInfo { hasNextPage endCursor }\n        nodes { %s }\n      }", c, args, connectionNodes[c])
}

// PullRequests lists pull requests by most recently updated, each with the
// first $nested nodes of every connection. Variables: owner, name, first,
// after, nested, and optionally states.
var PullRequests = func() Query {
	var b strings.Builder
	b.WriteString(`query PullRequests($owner: String!, $name: String!, $first: Int!, $after: String, $nested: Int!, $states: [PullRequestState!]) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
      ` + pullRequestFields + `
`)
	for _, c := range Connections {
		b.WriteString("      " + connectionSelection(c, "$nested", "") + "\n")
	}
	b.WriteString("      }\n    }\n  }\n}\n")
	return Query{Name: "PullRequests", Text: b.String()}
}()

// ConnectionPage returns the query for a further page of one pull
// request's connection c. Variables: owner, name, number, first, after.
func ConnectionPage(c Connection) Query {
	name := "PullRequest" + strings.ToUpper(string(c[:1])) + string(c[1:])
	return Query{Name: name, Text: `query ` + name + `($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ` + connectionSelection(c, "$first", "$after") + `
    }
  }
}
`}
}

// Counts asks for the repository's creation time and its listing's totals
// of pull requests, aliased total, and of open ones, aliased open.
// Variables: owner, name.
var Counts = Query{Name: "Counts", Text: `query Counts($owner: String!, $name: String!) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    createdAt
    total: pullRequests { totalCount }
    open: pullRequests(states: OPEN) { totalCount }
  }
}
`}

// SearchCount asks for the number of issues and pull requests a search
// matches. Variables: search.
var SearchCount = Query{Name: "SearchCount", Text: `query SearchCount($search: String!) {
  ` + rateLimitFields + `
  search(query: $search, type: ISSUE, first: 1) { issueCount }
}
`}

// commitNames selects a page of commits with the name git records for each
// commit's author and committer, and not their addresses or accounts.
func commitNames(args string) string {
	return `commits(` + args + `) {
        pageInfo { hasNextPage endCursor }
        nodes { commit { oid author { name } committer { name } } }
      }`
}

// CommitNames asks for the first $first commits of n pull requests in one
// request, each with its author's and committer's names: alias p<i> is the
// pull request numbered by variable n<i>. Variables: owner, name, first,
// n0 to n<n-1>.
func CommitNames(n int) Query {
	var vars, fields strings.Builder
	for i := range n {
		fmt.Fprintf(&vars, ", $n%d: Int!", i)
		fmt.Fprintf(&fields, "    p%d: pullRequest(number: $n%d) {\n      %s\n    }\n", i, i, commitNames("first: $first"))
	}
	return Query{Name: "CommitNames", Text: "query CommitNames($owner: String!, $name: String!, $first: Int!" + vars.String() + ") {\n  " +
		rateLimitFields + "\n  repository(owner: $owner, name: $name) {\n" + fields.String() + "  }\n}\n"}
}

// CommitNamesPage asks for a further page of one pull request's commits as
// CommitNames selects them. Variables: owner, name, number, first, after.
var CommitNamesPage = Query{Name: "CommitNamesPage", Text: `query CommitNamesPage($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ` + commitNames("first: $first, after: $after") + `
    }
  }
}
`}

// PullRequestNumbers asks whether n pull requests exist, in one request,
// selecting no more than each one's number: alias p<i> is the pull request
// numbered by variable n<i>, and null, with a NOT_FOUND error, for one
// GitHub cannot resolve. Variables: owner, name, n0 to n<n-1>.
func PullRequestNumbers(n int) Query {
	var vars, fields strings.Builder
	for i := range n {
		fmt.Fprintf(&vars, ", $n%d: Int!", i)
		fmt.Fprintf(&fields, "    p%d: pullRequest(number: $n%d) { number }\n", i, i)
	}
	return Query{Name: "PullRequestNumbers", Text: "query PullRequestNumbers($owner: String!, $name: String!" + vars.String() + ") {\n  " +
		rateLimitFields + "\n  repository(owner: $owner, name: $name) {\n" + fields.String() + "  }\n}\n"}
}

// AuthorBaselines asks for n search counts in one request: alias a<i>
// answers the search in variable q<i>.
func AuthorBaselines(n int) Query {
	var vars, fields strings.Builder
	for i := range n {
		if i > 0 {
			vars.WriteString(", ")
		}
		fmt.Fprintf(&vars, "$q%d: String!", i)
		fmt.Fprintf(&fields, "  a%d: search(query: $q%d, type: ISSUE, first: 1) { issueCount }\n", i, i)
	}
	return Query{Name: "AuthorBaselines", Text: "query AuthorBaselines(" + vars.String() + ") {\n  " +
		rateLimitFields + "\n" + fields.String() + "}\n"}
}
