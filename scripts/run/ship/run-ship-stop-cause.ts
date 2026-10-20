import { api_auth } from '#scripts/agent/api-auth'
import { NO_CHECKS_MESSAGE } from '#scripts/gh/git-pr-checks-watch'
import type { StopRecord } from '#scripts/lane/lane-ledger'
import { run_ship_stage, type Stage } from './run-ship-stage'

// Why a `josh ship` stage stopped, beside the stage it stopped at: a review that found something, a
// merge git could not finish, a check that went red, or the infrastructure — a rate limit, a check list
// GitHub did not return, a network blip — that a re-run clears (joshuafolkken/kit#3998).
//
// **Only a stage whose output is the tooling's own is read for infrastructure**: a gate's or a review's
// output carries test titles and findings, which may name a rate limit without being one, and their
// stops are the quality gate's own verdict — never retried, never relabelled.

const CAUSE = {
	FINDING: 'finding',
	INFRA: 'infra',
	CONFLICT: 'conflict',
	CHECK: 'check',
	AUTH: 'auth',
} as const

type Cause = (typeof CAUSE)[keyof typeof CAUSE]

const { STAGE } = run_ship_stage
const FINDING_STAGES: ReadonlySet<Stage> = new Set([STAGE.REVIEW, STAGE.ROUND_TWO])
const INFRA_STAGES: ReadonlySet<Stage> = new Set([
	STAGE.SYNC,
	STAGE.COMMIT,
	STAGE.FOLLOWUP,
	STAGE.REPORT,
])
const INFRA_PATTERNS: ReadonlyArray<RegExp> = [
	/rate limit/iu,
	new RegExp(NO_CHECKS_MESSAGE, 'u'),
	/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/u,
	/socket hang up/iu,
	/could not resolve host/iu,
	/\bHTTP 50[234]\b/u,
]

function is_infra(output: string): boolean {
	return INFRA_PATTERNS.some((pattern) => pattern.test(output))
}

// A reviewer that could not authenticate is no finding: the review steps put `AUTH_FAILURE_NOTE` at the
// head of a stop line (`isolated reviewer failed: <note>` or `<note>`), and only there is it read — a
// finding that quotes the note mid-line stays a finding (joshuafolkken/kit#4216).
const AUTH_LINE = new RegExp(
	`^(?:isolated reviewer failed: (?:the broker answered a failure: )?)?${api_auth.AUTH_FAILURE_NOTE}`,
	'mu',
)

function finding_cause(output: string): Cause {
	return AUTH_LINE.test(output) ? CAUSE.AUTH : CAUSE.FINDING
}

function cause_of(stage: Stage, output: string, conflicts?: ReadonlyArray<string>): Cause {
	const reason = run_ship_stage.stop_reason(stage, conflicts)

	if (reason === run_ship_stage.CONFLICT) return CAUSE.CONFLICT
	if (FINDING_STAGES.has(stage)) return finding_cause(output)

	return INFRA_STAGES.has(stage) && is_infra(output) ? CAUSE.INFRA : CAUSE.CHECK
}

// What a stopped stage handed back: its output, the paths a stopped merge left unmerged, and the kinds
// of the preconditions a stopped preflight found unmet.
interface StoppedOutput {
	body: string
	conflicts?: ReadonlyArray<string>
	preconditions?: ReadonlyArray<string>
}

const NO_OUTPUT: StoppedOutput = { body: '' }

// The lane ledger's record of one stop — the stage, its cause and, for a preflight, which
// preconditions were unmet, so `lane:stats` counts the one worth meeting before a ship
// (joshuafolkken/kit#4166).
function record_of(issue: number, stage: Stage, failed: StoppedOutput = NO_OUTPUT): StopRecord {
	const { body, conflicts, preconditions } = failed
	const reason = run_ship_stage.stop_reason(stage, conflicts)
	const cause = cause_of(stage, body, conflicts)

	return {
		issue,
		reason,
		cause,
		...(preconditions !== undefined && { preconditions: [...preconditions] }),
	}
}

const run_ship_stop_cause = { CAUSE, cause_of, record_of }

export type { Cause }
export { run_ship_stop_cause }
