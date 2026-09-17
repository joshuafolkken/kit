// Command fixtures shared by `delivered-rules.test.ts` and `delivered-rules-predicates.test.ts`.
// The two files were one until joshuafolkken/kit#1884 split the pure-predicate blocks off to keep
// the delivery suite under the 300-line limit; these commands are used by both, so they live here
// rather than being redeclared in each (no clones — single source).

// The shortest command that really files an Issue, reused wherever a case needs the trigger to match
// so that no case can pass on a spelling the others do not use.
const FILING_COMMAND = 'gh issue create --title "x"'
// The `gh api` spelling of the same filing, used both as a trigger case and as a collision case.
const FILING_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues -f title="x" -f body="y"'
// The read the body-only rule asks for. It has to pass both rows, or obeying would wedge the run — so
// it serves as a non-trigger fixture for each of them.
const COMMENTED_READ_COMMAND = 'gh issue view 1319 --comments'
// The shortest body-only Issue read, and the `gh api` spelling of the same. Reused wherever a case
// needs the second row's trigger to match.
const BODY_READ_COMMAND = 'gh issue view 1319'
const BODY_READ_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues/1319'
// A read that fetches the same Issue only to project its state or labels — a state check, not the body
// read the rule guards, so it is not a trigger (joshuafolkken/kit#1905).
const STATE_CHECK_COMMAND = "gh api repos/joshuafolkken/kit/issues/1319 --jq '{state, labels}'"
// The `--jq` spelling that still names the body, so it stays a body read.
const BODY_JQ_COMMAND = "gh api repos/joshuafolkken/kit/issues/1319 --jq '.body'"

export {
	BODY_JQ_COMMAND,
	BODY_READ_API_COMMAND,
	BODY_READ_COMMAND,
	COMMENTED_READ_COMMAND,
	FILING_API_COMMAND,
	FILING_COMMAND,
	STATE_CHECK_COMMAND,
}
