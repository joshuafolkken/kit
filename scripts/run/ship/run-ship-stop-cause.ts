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
//
// **A review round names its own cause**: the step of the round that stopped tags its result — a red
// join or scoped pair `check`, a reviewer that did not finish `infra`, a refused attestation `attest` —
// so only a stop on a recorded finding counts as one (joshuafolkken/kit#4431). An untagged review stop
// stays a finding.

const CAUSE = {
	FINDING: 'finding',
	INFRA: 'infra',
	CONFLICT: 'conflict',
	CHECK: 'check',
	AUTH: 'auth',
	ATTEST: 'attest',
} as const

type Cause = (typeof CAUSE)[keyof typeof CAUSE]

const { STAGE } = run_ship_stage
const REVIEW_STAGES: ReadonlySet<Stage> = new Set([STAGE.REVIEW, STAGE.ROUND_TWO])
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

function is_review(stage: Stage): boolean {
	return REVIEW_STAGES.has(stage)
}

function review_cause(output: string, tagged: Cause = CAUSE.FINDING): Cause {
	return AUTH_LINE.test(output) ? CAUSE.AUTH : tagged
}

// What a stopped stage handed back: its output, the paths a stopped merge left unmerged, the kinds
// of the preconditions a stopped preflight found unmet, and the cause a review round tagged its stop with.
interface StoppedOutput {
	body: string
	conflicts?: ReadonlyArray<string>
	preconditions?: ReadonlyArray<string>
	cause?: Cause
}

const NO_OUTPUT: StoppedOutput = { body: '' }

function cause_of(stage: Stage, failed: StoppedOutput): Cause {
	const { body, conflicts, cause } = failed
	const reason = run_ship_stage.stop_reason(stage, conflicts)

	if (reason === run_ship_stage.CONFLICT) return CAUSE.CONFLICT
	if (is_review(stage)) return review_cause(body, cause)

	return INFRA_STAGES.has(stage) && is_infra(body) ? CAUSE.INFRA : CAUSE.CHECK
}

// The lane ledger's record of one stop — the stage, its cause and, for a preflight, which
// preconditions were unmet, so `lane:stats` counts the one worth meeting before a ship
// (joshuafolkken/kit#4166).
function record_of(issue: number, stage: Stage, failed: StoppedOutput = NO_OUTPUT): StopRecord {
	const { conflicts, preconditions } = failed

	return {
		issue,
		reason: run_ship_stage.stop_reason(stage, conflicts),
		cause: cause_of(stage, failed),
		...(preconditions !== undefined && { preconditions: [...preconditions] }),
	}
}

const run_ship_stop_cause = { CAUSE, cause_of, is_review, record_of }

export type { Cause }
export { run_ship_stop_cause }
