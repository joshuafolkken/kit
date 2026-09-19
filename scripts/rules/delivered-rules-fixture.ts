import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'

// Command and transcript-tail fixtures shared by the delivery suites — `delivered-rules.test.ts`,
// `delivered-rules-predicates.test.ts`, `delivered-rules-filing.test.ts`, `issue-scout.test.ts` and
// `filing-cap.test.ts`. The first two were one file until joshuafolkken/kit#1884 split the
// pure-predicate blocks off to keep the delivery suite under the 300-line limit; the filing rows of
// joshuafolkken/kit#2119 added the tail builders (`filing_lines`, `filings_tail`, `scouted_tail`).
// These are used across the suites, so they live here rather than being redeclared in each (no
// clones — single source).

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

// The scout the filing rules ask for, and the minute the first fixture filing lands on
// (joshuafolkken/kit#2119).
const SCOUT_COMMAND = 'pnpm josh issue:scout "x"'
const A_FILING_MINUTE = 2

// A transcript tail carrying a `pnpm josh issue:scout` call, so a later filing has been scouted.
function scouted_tail(): string {
	return time_transcript_fixture.josh_call_line(1, time_transcript_fixture.BRANCH, SCOUT_COMMAND)
}

// One filing's two lines: the `gh` call that files, and the result the harness wrote back — a guard
// refusal when `is_refused`, an ordinary success otherwise. The cap excludes a guard-refused filing
// from the count, so a fixture can say one did not count.
function filing_lines(index: number, is_refused: boolean): Array<string> {
	const id = `filing-${String(index)}`
	const minute = index + A_FILING_MINUTE
	const branch = time_transcript_fixture.BRANCH
	const call = time_transcript_fixture.tool_call_line(minute, branch, {
		name: 'Bash',
		input: { command: FILING_API_COMMAND },
		id,
	})
	const result = is_refused
		? time_transcript_fixture.error_result_line(minute, branch, id, '⛔ backlog WIP cap: counted')
		: time_transcript_fixture.result_line(minute, branch, id)

	return [call, result]
}

// A scouted tail carrying `count` filings, of which the first `refused_count` were guard-refused.
function filings_tail(count: number, refused_count = 0): string {
	const lines = [scouted_tail()]

	for (let index = 0; index < count; index += 1) {
		lines.push(...filing_lines(index, index < refused_count))
	}

	return lines.join('\n')
}

export {
	BODY_JQ_COMMAND,
	BODY_READ_API_COMMAND,
	BODY_READ_COMMAND,
	COMMENTED_READ_COMMAND,
	FILING_API_COMMAND,
	FILING_COMMAND,
	SCOUT_COMMAND,
	STATE_CHECK_COMMAND,
	filing_lines,
	filings_tail,
	scouted_tail,
}
