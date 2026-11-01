import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { issue_state, type IssueState } from '#scripts/issue/issue-state'
import type { InvestigationRecord } from './run-investigation-record'

// `josh run:prep <N>` — the reads a `fullrun` makes before its first edit, assembled into one report.
// This joins the issue body and comments, the state and `human_review` line, and the dependency-update
// scope that `issue:read`, `issue:state` and `latest:scope` answer in three separate calls — reusing
// each rather than reproducing it.
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
const LOCATIONS_HEADER = '=== code locations ==='
const INVESTIGATION_HEADER = '=== investigation ==='
// The step the investigation guard would otherwise name only once it refuses, mid-reading (#4345).
const INVESTIGATION_BODY = `Delegate before the first read — the guard refuses at ${delegation_policy.INVESTIGATION_LIMIT}. ${delegation_policy.INVESTIGATION_STEP} Brief it with the code locations above; read in the main line only the files this run will edit.`
// An issue the entry reads as planned already carries its investigation in the recorded plan, so the
// run — a lane dispatched again after a yield among them — reads that instead of re-running the
// investigator (joshuafolkken/kit#5700).
const INVESTIGATION_PLANNED_BODY =
	'Skip the investigator — the plan is recorded (`run:planned` or a plan comment): the recorded plan in the issue (body or plan comment) is the investigation; read in the main line only the files this run will edit.'
// The investigator's conclusion an earlier read of this run saved (`run-investigation-record.ts`), so
// the implement phase reads it rather than delegating the same reading again (joshuafolkken/kit#5765).
const INVESTIGATION_SAVED_LEAD =
	'Skip the investigator — its conclusion is saved below; read in the main line only the files this run will edit, and delegate only what it does not answer:'
const INVESTIGATION_SAVE_STEP =
	"Save the investigator's conclusion (its `file:line` citations) with the Write tool to"
const SHIP_HEADER = '=== ship preconditions ==='
const SHIP_MET = 'met — nothing `josh ship` refuses on as the tree stands'
const SHIP_UNMET =
	'unmet — `josh ship` will refuse until these are fixed; fix them before the gate:'
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
	// Where the paths and identifiers the issue names occur in code.
	locations: string
	// Whether a lane child's tree holds uncommitted work — read for the verdict, not printed in the
	// report.
	has_changes: boolean
	// What `josh ship` would refuse on as the tree stands — `run_ship_preflight.ahead`.
	ship_problems: ReadonlyArray<string>
	// Whether the entry's stage read the issue as planned (`run_stage.PLANNED`) — set by `run:entry`,
	// which owns the stage; a bare `run:prep` leaves it unset.
	is_planned?: boolean
	// The investigation record — where it goes and what an earlier read saved; unset where no git
	// directory answers.
	investigation?: InvestigationRecord | undefined
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

function ship_body(problems: ReadonlyArray<string>): string {
	if (problems.length === 0) return SHIP_MET

	return [SHIP_UNMET, ...problems.map((problem) => `  - ${problem}`)].join('\n')
}

function save_step(record: InvestigationRecord | undefined): string {
	return record === undefined ? '' : ` ${INVESTIGATION_SAVE_STEP} \`${record.path}\`.`
}

// Saved findings first, being this run's own; then a recorded plan; else delegate and save the answer.
function investigation_body(parts: PrepParts): string {
	const findings = parts.investigation?.findings

	if (findings !== undefined) return `${INVESTIGATION_SAVED_LEAD}\n${findings}`
	if (parts.is_planned === true) return INVESTIGATION_PLANNED_BODY

	return `${INVESTIGATION_BODY}${save_step(parts.investigation)}`
}

function format_report(parts: PrepParts): string {
	return [
		summary(parts),
		section(CONTENT_HEADER, parts.content_body),
		section(STATE_HEADER, state_body(parts)),
		section(LATEST_HEADER, `${parts.latest_scope}${LATEST_JOINER}${parts.latest_reason}`),
		section(LOCATIONS_HEADER, parts.locations),
		section(INVESTIGATION_HEADER, investigation_body(parts)),
		section(SHIP_HEADER, ship_body(parts.ship_problems)),
	].join(SECTION_SEPARATOR)
}

const run_prep = {
	CONTENT_HEADER,
	INVESTIGATION_HEADER,
	INVESTIGATION_PLANNED_BODY,
	INVESTIGATION_SAVED_LEAD,
	INVESTIGATION_SAVE_STEP,
	LATEST_HEADER,
	LOCATIONS_HEADER,
	SHIP_HEADER,
	SHIP_UNMET,
	STATE_HEADER,
	SUMMARY_PREFIX,
	format_report,
	ship_body,
	summary,
}

export type { PrepParts }
export { run_prep }
