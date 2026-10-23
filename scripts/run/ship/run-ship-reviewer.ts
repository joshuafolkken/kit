import { agent_argv, type AgentArgv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { api_auth } from '#scripts/agent/api-auth'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_ship_brokered_review } from './run-ship-brokered-review'
import { run_ship_review, type PromptOf } from './run-ship-review'
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
const KEPT_REVIEW_NOTE =
	'the reviewer wrote its findings before it failed — its review is kept; attest and record judge it.'
type Round = '1' | '2'

const ROUND_ONE: Round = '1'
const ROUND_TWO: Round = '2'

interface SlotOpen {
	open: ReadonlyArray<string>
	slot: ReviewSlot
}

interface Briefed {
	brief: string
	slot: ReviewSlot
}

const { CAUSE } = run_ship_stop_cause
const { CODE } = review_attest.REVIEW_SLOT

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

function paths(slot?: ReviewSlot): { brief: string; findings: string; log: string } {
	return lane_session_broker.review_paths(PROJECT_ROOT, slot)
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

function current_verdict(slot?: ReviewSlot): ReturnType<typeof run_ship_review.read_verdict> {
	return run_ship_review.read_verdict(stamp_file.read_stamp_text(paths(slot).findings))
}

// **A session that ran and then failed keeps the review it wrote** (joshuafolkken/kit#4562). The
// findings file is removed before the launch and written as the reviewer's last step, so a readable one
// is this session's finished review — a late auth failure or a lost broker reply then costs nothing,
// where a relaunch would review the whole change again. The attest and record phases still judge it.
// A broker answers for every slot it ran at once, so each slot's file must be readable.
function ended_session(failed_note: string, slots: ReadonlyArray<ReviewSlot> = [CODE]): JoshResult {
	if (slots.some((slot) => current_verdict(slot).kind === run_ship_review.VERDICT.INVALID)) {
		return failure(failed_note, CAUSE.INFRA)
	}

	note(`${failed_note}\n${KEPT_REVIEW_NOTE}`)

	return { code: SUCCESS_EXIT_CODE, out: '' }
}

// Under the round's reviewer profile — the same model and effort (`JOSH_REVIEWER_*` included) the
// chain's subagent is given — and waited on, so the join below runs only once the review has finished.
// Each call is its own process, so round 2 is a fresh session by construction. A failed session is
// judged on its own slot's findings, not on a sibling's still being written.
async function run_direct_session(
	argv: AgentArgv,
	profile: AgentProfile,
	slot: ReviewSlot,
	round: Round,
): Promise<JoshResult> {
	const log_path = paths(slot).log
	const request = { argv, cwd: PROJECT_ROOT, log_path, profile }

	note(agent_role_profile.describe_review(Number(round), profile))
	const result = await detached_launch.launch_attached(request, note)

	if (result.kind === 'failed') {
		return failure(`reviewer could not start: ${result.note}`, CAUSE.INFRA)
	}

	if (result.exit_code !== SUCCESS_EXIT_CODE) return ended_session(exited_note(log_path), [slot])

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

interface SlotSession {
	slot: ReviewSlot
	built: AgentArgvResult
}

function session_for(
	prompt_of: PromptOf,
	issue: string,
	round: Round,
	slots: { slot: ReviewSlot; all: ReadonlyArray<ReviewSlot> },
): SlotSession {
	const { slot, all } = slots
	const target = paths(slot)
	const prompt = run_ship_review.slot_prompt(prompt_of, slot, all)(
		target.brief,
		target.findings,
		issue,
	)

	return { slot, built: agent_argv.review_in(prompt, Number(round), PROJECT_ROOT) }
}

async function run_slot(session: SlotSession, round: Round): Promise<JoshResult> {
	const { built, slot } = session

	if (built.kind === 'rejected') {
		return failure(`reviewer profile rejected: ${built.note}`, CAUSE.INFRA)
	}

	return await run_direct_session(built.argv, built.profile, slot, round)
}

async function run_brokered(
	issue: string,
	round: Round,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<JoshResult> {
	const answer = await run_ship_brokered_review.request(PROJECT_ROOT, issue, round, slots)

	return answer.is_success
		? { code: SUCCESS_EXIT_CODE, out: '' }
		: ended_session(`isolated reviewer failed: ${answer.reason}`, slots)
}

// **The slots' reviewers run side by side** (joshuafolkken/kit#4672), and the first failure among
// them is the result — each slot is launched through the same path a single review takes.
async function run_sessions(
	prompt_of: PromptOf,
	issue: string,
	round: Round,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<JoshResult> {
	const sessions = slots.map((slot) => session_for(prompt_of, issue, round, { slot, all: slots }))
	const [first] = sessions

	if (first?.built.kind === 'argv' && is_brokered(first.built.profile, issue)) {
		return await run_brokered(issue, round, slots)
	}

	const results = await Promise.all(sessions.map(async (session) => await run_slot(session, round)))

	return (
		results.find((result) => result.code !== SUCCESS_EXIT_CODE) ?? {
			code: SUCCESS_EXIT_CODE,
			out: '',
		}
	)
}

// The brief goes to a file and the previous round's findings are removed, so a reviewer that writes
// nothing reads as unfinished rather than as the last round's verdict.
async function launch_reviewers(
	briefs: ReadonlyArray<Briefed>,
	prompt_of: PromptOf,
	issue: string,
	round: Round,
): Promise<JoshResult> {
	for (const { brief, slot } of briefs) {
		const target = paths(slot)

		stamp_file.write_text_stamp(target.brief, brief)
		stamp_file.remove_stamp(target.findings)
	}

	return await run_sessions(
		prompt_of,
		issue,
		round,
		briefs.map(({ slot }) => slot),
	)
}

// A refused attestation — the issue changed after the brief, an update left unread, no attestation —
// is no finding: the round read what it was briefed on. `review:attest --check` asks every slot.
async function attest_phase(): Promise<StepResult> {
	return tagged(CAUSE.ATTEST, await josh(ATTEST_CHECK))
}

// Each slot's brief-minting command in turn, then their reviewers side by side, each handed what its
// command printed. The slots are the ones asked for, not the ones whose command has run so far.
function reviewed_together(
	opens: ReadonlyArray<SlotOpen>,
	prompt_of: PromptOf,
	issue: string,
	round: Round,
): ReadonlyArray<Phase> {
	const printed = new Map<ReviewSlot, string>()

	function briefs(): ReadonlyArray<Briefed> {
		return opens.map(({ slot }) => ({ brief: printed.get(slot) ?? '', slot }))
	}

	return [
		...opens.map(({ open, slot }) => async () => {
			const result = await josh(open)

			printed.set(slot, result.out)

			return tagged(CAUSE.CHECK, result)
		}),
		async () => await launch_reviewers(briefs(), prompt_of, issue, round),
	]
}

// A brief-minting command, then a reviewer handed what it printed.
function reviewed(
	open: ReadonlyArray<string>,
	prompt_of: PromptOf,
	issue: string,
	round: Round,
): ReadonlyArray<Phase> {
	return reviewed_together([{ open, slot: CODE }], prompt_of, issue, round)
}

const run_ship_reviewer = {
	attest_phase,
	current_verdict,
	failure,
	josh,
	note,
	paths,
	reviewed,
	reviewed_together,
	ROUND_ONE,
	ROUND_TWO,
	SUCCESS_EXIT_CODE,
	tagged,
	tagged_phase,
}

export type { Round }
export { run_ship_reviewer }
