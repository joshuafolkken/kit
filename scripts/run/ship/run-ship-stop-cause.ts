import { api_auth } from '#scripts/agent/api-auth'
import { UNREADABLE_COMMENTS_STOP } from '#scripts/gh/git-gh-comments-unreadable'
import { gh_retry } from '#scripts/gh/git-gh-retry'
import { NO_CHECKS_MESSAGE } from '#scripts/gh/git-pr-checks-watch'
import { git_error } from '#scripts/git/git-error'
import type { StopRecord } from '#scripts/lane/lane-ledger'
import { run_ship_review, type StopFinding } from './run-ship-review'
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
	new RegExp(UNREADABLE_COMMENTS_STOP, 'u'),
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
	// The standard output alone, read for the infrastructure in place of the body when present.
	out?: string
	conflicts?: ReadonlyArray<string>
	preconditions?: ReadonlyArray<string>
	cause?: Cause
}

const NO_OUTPUT: StoppedOutput = { body: '' }

// A failed stage's body also carries its stderr, where a poll warns of a transient rate limit it then
// recovered from — so the infrastructure is read on the standard output alone wherever the stage kept it.
function infra_text({ body, out = body }: StoppedOutput): string {
	return out
}

const FAILURE_LINE = new RegExp(`^${git_error.FAILURE_PREFIX} (?<message>.*)$`, 'gmu')

function final_failure(body: string): string | undefined {
	const { message } = [...body.matchAll(FAILURE_LINE)].at(-1)?.groups ?? {}

	return message
}

// A gh request transient to its last attempt notes so on stderr — gh's own transient verdict, never a
// second list of its errors (joshuafolkken/kit#5052). A caller may catch it and stop later on a red
// check, so the note counts only when it names the failure the stage ended on.
function is_spent_stop(body: string): boolean {
	const message = final_failure(body)

	return message !== undefined && body.includes(gh_retry.spent_note(message))
}

function is_infra_stop(failed: StoppedOutput): boolean {
	return is_infra(infra_text(failed)) || is_spent_stop(failed.body)
}

// A gate an infrastructure stage ran itself tags its red as a check: its output is test output, where
// a title naming a rate limit is no outage (joshuafolkken/kit#4825).
function stage_cause(stage: Stage, failed: StoppedOutput): Cause {
	if (failed.cause === CAUSE.CHECK || !INFRA_STAGES.has(stage)) return CAUSE.CHECK

	return is_infra_stop(failed) ? CAUSE.INFRA : CAUSE.CHECK
}

function cause_of(stage: Stage, failed: StoppedOutput): Cause {
	const { body, conflicts, cause } = failed
	const reason = run_ship_stage.stop_reason(stage, conflicts)

	if (reason === run_ship_stage.CONFLICT) return CAUSE.CONFLICT
	if (is_review(stage)) return review_cause(body, cause)

	return stage_cause(stage, failed)
}

// Whether a finding decided the stop — false on any other stop, and on a review stop no finding decided
// (a red gate at the join, a reviewer that never answered).
function is_finding_stop(stage: Stage, cause: Cause): boolean {
	return is_review(stage) && cause === CAUSE.FINDING
}

// The kind of every blocking finding a review stop's output lists.
function findings_of(stage: Stage, cause: Cause, body: string): ReadonlyArray<string> {
	return is_finding_stop(stage, cause) ? run_ship_review.blocking_kinds(body) : []
}

// Each finding that decided a review stop, whole, for the durable stop log (joshuafolkken/kit#4519).
function details_of(stage: Stage, failed: StoppedOutput = NO_OUTPUT): ReadonlyArray<StopFinding> {
	if (!is_finding_stop(stage, cause_of(stage, failed))) return []

	return run_ship_review.blocking_details(failed.body)
}

// The lane ledger's record of one stop — the stage, its cause and, for a preflight, which
// preconditions were unmet, so `lane:stats` counts the one worth meeting before a ship
// (joshuafolkken/kit#4166); for a review, which kinds of finding stopped it (joshuafolkken/kit#4426).
function record_of(issue: number, stage: Stage, failed: StoppedOutput = NO_OUTPUT): StopRecord {
	const { body, conflicts, preconditions } = failed
	const cause = cause_of(stage, failed)
	const findings = findings_of(stage, cause, body)

	return {
		issue,
		reason: run_ship_stage.stop_reason(stage, conflicts),
		cause,
		...(preconditions !== undefined && { preconditions: [...preconditions] }),
		...(findings.length > 0 && { findings: [...findings] }),
	}
}

const run_ship_stop_cause = { CAUSE, cause_of, details_of, is_review, record_of }

export type { Cause }
export { run_ship_stop_cause }
