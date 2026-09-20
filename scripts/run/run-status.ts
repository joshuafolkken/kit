import { issue_state, type IssueState } from '#scripts/issue/issue-state'

// `josh run:status <N>` — the read-only status a run glances at, assembled into one report
// (joshuafolkken/kit#2165). A run reads three independent facts to know where it stands — the issue's
// own state, whether the session has crossed the hand-off budget, and its own carry counters — and
// the procedure had it type `issue:state`, `cost --cut` and `run:carry` as three separate steps. This
// joins the answers those three commands give, reusing each rather than reproducing it.
//
// **It is read-only, and that is the whole point** — the merge event has its own composite
// (`run:merge`), and the pre-edit reads have theirs (`run:prep`); what was left was the passive glance
// a resumed session or a non-merge decision takes, which must not write. `run:hold`'s claim and
// `run:progress`'s clock mark are excluded for exactly that reason.
//
// The leading summary line carries the three facts on one line — the state, the cost verdict and the
// carry summary — so the glance is read off the first line without parsing the sections below it.

const SUMMARY_PREFIX = 'status #'
const STATE_LABEL = 'state: '
const COST_LABEL = 'cost: '
const RUN_LABEL = 'run: '
const FIELD_SEPARATOR = ' · '
const SUMMARY_DASH = ' — '
const UNKNOWN = '?'
const STATE_HEADER = '=== state ==='
const COST_HEADER = '=== cost ==='
const RUN_HEADER = '=== run ==='
const SECTION_SEPARATOR = '\n\n'

interface StatusParts {
	issue_number: string
	// `undefined` when the state read failed; `state_failure` then carries the note that stands in for
	// the three-line block, so a bundled failure never prints as an empty state.
	state: IssueState | undefined
	state_failure: string
	cost_verdict: string
	// The one-liner form (`2 merged`, `none`, `unreadable`) and the full body, computed by the CLI so
	// this formatter stays a pure string join, exactly as `run-prep` computes its latest scope.
	carry_summary: string
	carry_detail: string
}

function summary(parts: StatusParts): string {
	const state_value = parts.state === undefined ? UNKNOWN : parts.state.state
	const fields = [
		`${STATE_LABEL}${state_value}`,
		`${COST_LABEL}${parts.cost_verdict}`,
		`${RUN_LABEL}${parts.carry_summary}`,
	]

	return `${SUMMARY_PREFIX}${parts.issue_number}${SUMMARY_DASH}${fields.join(FIELD_SEPARATOR)}`
}

// The state's three lines come from `issue:state`'s own formatter, so the spelling a document compares
// against — `human_review: yes` included — is the one this bundle prints.
function state_body(parts: StatusParts): string {
	return parts.state === undefined
		? parts.state_failure
		: issue_state.format_issue_state(parts.state)
}

function section(header: string, body: string): string {
	return `${header}\n${body}`
}

function format_report(parts: StatusParts): string {
	return [
		summary(parts),
		section(STATE_HEADER, state_body(parts)),
		section(COST_HEADER, parts.cost_verdict),
		section(RUN_HEADER, parts.carry_detail),
	].join(SECTION_SEPARATOR)
}

const run_status = { COST_HEADER, RUN_HEADER, STATE_HEADER, SUMMARY_PREFIX, format_report }

export type { StatusParts }
export { run_status }
