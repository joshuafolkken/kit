import { NO_CHECKS_MESSAGE } from '#scripts/gh/git-pr-checks-watch'
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

function cause_of(stage: Stage, output: string, conflicts?: ReadonlyArray<string>): Cause {
	const reason = run_ship_stage.stop_reason(stage, conflicts)

	if (reason === run_ship_stage.CONFLICT) return CAUSE.CONFLICT
	if (FINDING_STAGES.has(stage)) return CAUSE.FINDING

	return INFRA_STAGES.has(stage) && is_infra(output) ? CAUSE.INFRA : CAUSE.CHECK
}

const run_ship_stop_cause = { CAUSE, cause_of }

export type { Cause }
export { run_ship_stop_cause }
