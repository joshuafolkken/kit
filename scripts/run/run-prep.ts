import { issue_state, type IssueState } from '#scripts/issue/issue-state'

// `josh run:prep <N>` — the reads a `fullrun` makes before its first edit, assembled into one report
// (joshuafolkken/kit#1978). Two earlier passes at the setup phase were a documentation rule
// (joshuafolkken/kit#1847) and a measurement (joshuafolkken/kit#1868); neither was an execution-side
// change, and the `setup` median did not move. This joins the issue body and comments, the state and
// `human_review` line, and the dependency-update scope that `issue:read`, `issue:state` and
// `latest:scope` answered in three separate calls — reusing each rather than reproducing it.
//
// The leading summary line carries the three facts a run branches on — the state, whether the issue
// stops before its commit, and whether a dependency update is owed — so the decision is read off the
// first line without parsing the sections below it.

const SUMMARY_PREFIX = 'prep #'
const STATE_LABEL = 'state: '
const HUMAN_REVIEW_LABEL = 'human_review: '
const LATEST_LABEL = 'latest: '
const FIELD_SEPARATOR = ' · '
const SUMMARY_DASH = ' — '
const UNKNOWN = '?'
const YES = 'yes'
const NO = 'no'
const CONTENT_HEADER = '=== issue ==='
const STATE_HEADER = '=== state ==='
const LATEST_HEADER = '=== dependency update ==='
const SECTION_SEPARATOR = '\n\n'
const LATEST_JOINER = ' — '

interface PrepParts {
	issue_number: string
	content_body: string
	// `undefined` when the state read failed; `state_failure` then carries the note that stands in for
	// the three-line block, so a bundled failure never prints as an empty state.
	state: IssueState | undefined
	state_failure: string
	latest_scope: string
	latest_reason: string
}

function human_review_value(state: IssueState | undefined): string {
	if (state === undefined) return UNKNOWN

	return state.is_human_review ? YES : NO
}

function summary(parts: PrepParts): string {
	const state_value = parts.state === undefined ? UNKNOWN : parts.state.state
	const fields = [
		`${STATE_LABEL}${state_value}`,
		`${HUMAN_REVIEW_LABEL}${human_review_value(parts.state)}`,
		`${LATEST_LABEL}${parts.latest_scope}`,
	]

	return `${SUMMARY_PREFIX}${parts.issue_number}${SUMMARY_DASH}${fields.join(FIELD_SEPARATOR)}`
}

// The state's three lines come from `issue:state`'s own formatter, so the spelling a document compares
// against — `human_review: yes` included — is the one this bundle prints.
function state_body(parts: PrepParts): string {
	return parts.state === undefined
		? parts.state_failure
		: issue_state.format_issue_state(parts.state)
}

function section(header: string, body: string): string {
	return `${header}\n${body}`
}

function format_report(parts: PrepParts): string {
	return [
		summary(parts),
		section(CONTENT_HEADER, parts.content_body),
		section(STATE_HEADER, state_body(parts)),
		section(LATEST_HEADER, `${parts.latest_scope}${LATEST_JOINER}${parts.latest_reason}`),
	].join(SECTION_SEPARATOR)
}

const run_prep = { CONTENT_HEADER, LATEST_HEADER, STATE_HEADER, SUMMARY_PREFIX, format_report }

export type { PrepParts }
export { run_prep }
