import { agent_argv, type AgentArgv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { api_auth } from '#scripts/agent/api-auth'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_ship_review } from './run-ship-review'
import type { Phase } from './run-ship-scoped'
import { run_ship_stop_cause, type Cause } from './run-ship-stop-cause'
import type { StepResult } from './run-ship-sync'

// The reviewer half of `josh ship --review` (`run-ship-review-steps.ts`): a brief-minting command, a
// reviewer session handed what it printed, and the attestation that the session read this checkout.
// Every review round the ship runs — round 1, the interaction review, round 2 — launches through here.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const ATTEST_CHECK = ['review:attest', '--check']
type Round = '1' | '2'

const ROUND_ONE: Round = '1'
const ROUND_TWO: Round = '2'
type PromptOf = (brief_path: string, findings_path: string, issue: string) => string

const { CAUSE } = run_ship_stop_cause

// **Every stop is tagged with the step's own cause**, so a round that stopped on a red join, a reviewer
// that did not finish or a refused attestation is not booked as a finding (joshuafolkken/kit#4431).
function failure(out: string, cause: Cause): StepResult {
	return { code: FAILURE_EXIT_CODE, out, cause }
}

function tagged(cause: Cause, result: JoshResult): StepResult {
	return result.code === SUCCESS_EXIT_CODE ? result : { ...result, cause }
}

function tagged_phase(cause: Cause, phase: Phase): Phase {
	return async () => tagged(cause, await phase())
}

function paths(): { brief: string; findings: string; log: string } {
	return lane_session_broker.review_paths(PROJECT_ROOT)
}

async function josh(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

function note(text: string): void {
	process.stderr.write(`${text}\n`)
}

// A reviewer that could not authenticate is named as such (`api-auth.ts`), so the stop is not booked as
// a review finding (joshuafolkken/kit#4216).
function exited_note(log_path: string): string {
	const exited = `reviewer failed — log: ${log_path}`

	if (!api_auth.is_auth_failed_transcript(stamp_file.read_stamp_text(log_path))) return exited

	return `${api_auth.AUTH_FAILURE_NOTE}: ${exited}`
}

// Under the round's reviewer profile — the same model and effort (`JOSH_REVIEWER_*` included) the
// chain's subagent is given — and waited on, so the join below runs only once the review has finished.
// Each call is its own process, so round 2 is a fresh session by construction.
async function run_direct_session(
	argv: AgentArgv,
	profile: AgentProfile,
	log_path: string,
	round: Round,
): Promise<JoshResult> {
	const request = { argv, cwd: PROJECT_ROOT, log_path, profile }

	note(agent_role_profile.describe_review(Number(round), profile))
	const result = await detached_launch.launch_attached(request, note)

	if (result.kind === 'failed') {
		return failure(`reviewer could not start: ${result.note}`, CAUSE.INFRA)
	}

	if (result.exit_code !== SUCCESS_EXIT_CODE) return failure(exited_note(log_path), CAUSE.INFRA)

	return { code: SUCCESS_EXIT_CODE, out: '' }
}

// A lane child's reviewer is started by the lane's broker: an OpenAI lane's always, since a nested Codex
// cannot write outside its sandbox, and a Claude lane's whenever the `run:wake` supervisor serves it, since this
// ship was started from the child's Bash tool and so never received a token-only credential
// (joshuafolkken/kit#3817). A Claude lane nobody serves starts the reviewer itself, as before.
function is_brokered(profile: AgentProfile, issue: string): boolean {
	if (!lane_child_marker.is_child_of(PROJECT_ROOT)) return false

	return profile.provider === 'openai' || lane_session_broker.is_serving(PROJECT_ROOT, issue)
}

async function run_session(
	prompt: string,
	log_path: string,
	issue: string,
	round: Round,
): Promise<JoshResult> {
	const built = agent_argv.review_in(prompt, Number(round), PROJECT_ROOT)

	if (built.kind === 'rejected') {
		return failure(`reviewer profile rejected: ${built.note}`, CAUSE.INFRA)
	}

	if (!is_brokered(built.profile, issue)) {
		return await run_direct_session(built.argv, built.profile, log_path, round)
	}

	const answer = await lane_session_broker.request(PROJECT_ROOT, issue, { kind: 'review', round })

	return answer.is_success
		? { code: SUCCESS_EXIT_CODE, out: '' }
		: failure(`isolated reviewer failed: ${answer.reason}`, CAUSE.INFRA)
}

// The brief goes to a file and the previous round's findings are removed, so a reviewer that writes
// nothing reads as unfinished rather than as the last round's verdict.
async function launch_reviewer(
	brief: string,
	prompt_of: PromptOf,
	issue: string,
	round: Round,
): Promise<JoshResult> {
	const target = paths()

	stamp_file.write_text_stamp(target.brief, brief)
	stamp_file.remove_stamp(target.findings)

	return await run_session(
		prompt_of(target.brief, target.findings, issue),
		target.log,
		issue,
		round,
	)
}

function current_verdict(): ReturnType<typeof run_ship_review.read_verdict> {
	return run_ship_review.read_verdict(stamp_file.read_stamp_text(paths().findings))
}

// A refused attestation — the issue changed after the brief, an update left unread, no attestation —
// is no finding: the round read what it was briefed on.
async function attest_phase(): Promise<StepResult> {
	return tagged(CAUSE.ATTEST, await josh(ATTEST_CHECK))
}

// A brief-minting command, then a reviewer handed what it printed.
function reviewed(
	open: ReadonlyArray<string>,
	prompt_of: PromptOf,
	issue: string,
	round: Round,
): ReadonlyArray<Phase> {
	const opened = { brief: '' }

	return [
		async () => {
			const result = await josh(open)

			opened.brief = result.out

			return tagged(CAUSE.CHECK, result)
		},
		async () => await launch_reviewer(opened.brief, prompt_of, issue, round),
	]
}

const run_ship_reviewer = {
	attest_phase,
	current_verdict,
	failure,
	josh,
	note,
	paths,
	reviewed,
	ROUND_ONE,
	ROUND_TWO,
	SUCCESS_EXIT_CODE,
	tagged,
	tagged_phase,
}

export type { Round }
export { run_ship_reviewer }
