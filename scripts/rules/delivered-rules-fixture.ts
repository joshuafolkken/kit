import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'

// Command and transcript-tail fixtures shared by the delivery suites — `delivered-rules.test.ts`,
// `delivered-rules-predicates.test.ts`, `delivered-rules-filing.test.ts` and `filing-cap.test.ts`.
// These are used across the suites, so they live here rather than being redeclared in each (no
// clones — single source).

// The filing act the run-level filing rows trigger on — `josh issue:file` —
// reused wherever a case needs that trigger to match so no case can pass on a spelling the others do
// not use.
const FILING_COMMAND = 'pnpm josh issue:file "x" --body-file body.md --depth 1'
// The two hand-built spellings of a filing, which the `direct-filing` row refuses on every occurrence.
const DIRECT_FILING_COMMAND = 'gh issue create --title "x"'
const DIRECT_FILING_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues -f title="x" -f body="y"'
// The read the body-only rule asks for. It has to pass both rows, or obeying would wedge the run — so
// it serves as a non-trigger fixture for each of them.
const COMMENTED_READ_COMMAND = 'gh issue view 1319 --comments'
// The shortest body-only Issue read, and the `gh api` spelling of the same. Reused wherever a case
// needs the second row's trigger to match.
const BODY_READ_COMMAND = 'gh issue view 1319'
const BODY_READ_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues/1319'
// A read that fetches the same Issue only to project its state or labels — a state check, not the body
// read the rule guards, so it is not a trigger.
const STATE_CHECK_COMMAND = "gh api repos/joshuafolkken/kit/issues/1319 --jq '{state, labels}'"
// The `--jq` spelling that still names the body, so it stays a body read.
const BODY_JQ_COMMAND = "gh api repos/joshuafolkken/kit/issues/1319 --jq '.body'"

// The minute the first fixture filing lands on.
const A_FILING_MINUTE = 2

// One filing's two lines: the `issue:file` call, and the result the harness wrote back — a failure
// when `is_refused`, an ordinary success otherwise. The cap excludes a failed filing from the count,
// so a fixture can say one did not count.
function filing_lines(index: number, is_refused: boolean): Array<string> {
	const id = `filing-${String(index)}`
	const minute = index + A_FILING_MINUTE
	const branch = time_transcript_fixture.BRANCH
	const call = time_transcript_fixture.tool_call_line(minute, branch, {
		name: 'Bash',
		input: { command: FILING_COMMAND },
		id,
	})
	const result = is_refused
		? time_transcript_fixture.error_result_line(minute, branch, id, '⛔ backlog WIP cap: counted')
		: time_transcript_fixture.result_line(minute, branch, id)

	return [call, result]
}

// A tail carrying `count` filings, of which the first `refused_count` failed.
function filings_tail(count: number, refused_count = 0): string {
	const lines: Array<string> = []

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
	DIRECT_FILING_API_COMMAND,
	DIRECT_FILING_COMMAND,
	FILING_COMMAND,
	STATE_CHECK_COMMAND,
	filing_lines,
	filings_tail,
}
