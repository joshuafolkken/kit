import { existsSync } from 'node:fs'
import path from 'node:path'
import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { api_auth } from '#scripts/agent/api-auth'
import { distributed_paths } from '#scripts/init/distributed-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { detached_launch, type AttachedLaunchResult } from '#scripts/run/detached-launch'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { run_ship_stop_cause } from '#scripts/run/ship/run-ship-stop-cause'
import { run_ship_stop_context } from '#scripts/run/ship/run-ship-stop-context'
import { z } from 'zod'
import { lane_child_invocation, type ShipStop } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_parked } from './lane-parked'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'

// The actions a lane's session broker performs for the ship that asked (`lane-session-broker.ts`):
// starting the round-1 reviewers or the round-2 reviewer, or relaunching the lane's child after a stopped ship.
// **A failure names its reason**: a bare `false` left every relaunch a stale supervisor refused
// unexplained in the ship log (joshuafolkken/kit#3974).

const BRIEF_PREFIX = 'josh-ship-review-brief-'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'
const LOG_PREFIX = 'josh-ship-review-log-'
const SUBMIT_SCRIPT = 'scripts/review/review-submit-cli.ts'
const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const stop_schema = z
	.object({
		stage: z.enum(run_ship_stage.STAGE),
		title: z.string(),
		flags: z.array(z.string()).readonly(),
		is_review: z.boolean(),
		unpinned_ok: z.array(z.string()).readonly().exactOptional(),
		conflicts: z.array(z.string()).readonly().default([]),
		cause: z.enum(run_ship_stop_cause.CAUSE).exactOptional(),
		is_review_stale: z.boolean().exactOptional(),
		context: run_ship_stop_context.stop_context_schema.exactOptional(),
	})
	.strict()
// `slots` is omitted for `/code-review` alone, so a supervisor still on the code before it reads the
// request as before; it names the reviews a ship runs side by side (joshuafolkken/kit#4672).
const slots_schema = z.array(z.enum(review_attest.REVIEW_SLOTS)).readonly()
const action_schema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('review'),
			round: z.enum(['1', '2']),
			slots: slots_schema.exactOptional(),
		})
		.strict(),
	z.object({ kind: z.literal('relaunch'), stop: stop_schema }).strict(),
])
const request_schema = z
	.object({ session: z.uuid(), nonce: z.uuid(), action: action_schema })
	.strict()
type ReviewRound = Extract<z.infer<typeof action_schema>, { kind: 'review' }>['round']

interface ReviewAction {
	kind: 'review'
	round: ReviewRound
	slots?: ReadonlyArray<ReviewSlot>
}

type BrokerAction = ReviewAction | { kind: 'relaunch'; stop: ShipStop }

interface ReviewPaths {
	brief: string
	findings: string
	log: string
}

type BrokerAnswer = { is_success: true } | { is_success: false; reason: string }

const SUCCESS: BrokerAnswer = { is_success: true }

function failure(reason: string): BrokerAnswer {
	return { is_success: false, reason }
}

// **Each review slot has its own files**: `/code-review` and the interaction review run side by side
// (joshuafolkken/kit#4672), so neither overwrites the other's brief, findings or log.
function review_paths(
	directory: string,
	slot: ReviewSlot = review_attest.REVIEW_SLOT.CODE,
): ReviewPaths {
	const prefix = slot === review_attest.REVIEW_SLOT.CODE ? '' : 'interaction-'

	return {
		brief: stamp_file.stamp_path(`${BRIEF_PREFIX}${prefix}`, directory, '.md'),
		findings: stamp_file.stamp_path(`${FINDINGS_PREFIX}${prefix}`, directory, '.txt'),
		log: stamp_file.stamp_path(`${LOG_PREFIX}${prefix}`, directory, '.log'),
	}
}

// The reviewer runs on the lane's own provider, so a Claude lane's server never starts a Codex reviewer
// and an OpenAI lane's never starts a Claude one.
function provider_of(lane: LaneInfo): AgentProvider {
	return lane.profile?.provider ?? ANTHROPIC_PROVIDER
}

// **The reviewer carries the lane's mark explicitly**: the supervisor serving a Claude lane is no lane child,
// so a reviewer inheriting its environment would descend from the carry record's owner unmarked and be
// read as the `backlogrun` parent by every hook. **Its prompt ends with the review invocation**, so the
// lane's liveness read and the park's reap find it as they find the child (joshuafolkken/kit#3878).

function action_slots(action: ReviewAction): ReadonlyArray<ReviewSlot> {
	return action.slots ?? [review_attest.REVIEW_SLOT.CODE]
}

// **A lane branched before `review:submit` is handed its findings path** (joshuafolkken/kit#4799): the
// reviewer runs the lane's own josh, and a supervisor reloaded onto main serves lanes that predate it.
function has_submit(directory: string): boolean {
	return [SUBMIT_SCRIPT, `${distributed_paths.KIT_PACKAGE_PATH_PREFIX}${SUBMIT_SCRIPT}`].some(
		(script) => existsSync(path.join(directory, script)),
	)
}

function review_prompt(lane: LaneInfo, action: ReviewAction, slot: ReviewSlot): string {
	const { brief, findings } = review_paths(lane.directory, slot)
	const round_prompt =
		action.round === '1' ? run_ship_review.reviewer_prompt : run_ship_review.verification_prompt
	const prompt_of = run_ship_review.slot_prompt(round_prompt, slot, action_slots(action))
	const tail = lane_child_invocation.review_invocation(lane.issue)
	const findings_path = has_submit(lane.directory) ? undefined : findings

	return `${prompt_of(brief, slot, lane.issue, findings_path)} This is ${tail}`
}

// **A reviewer that could not authenticate names it** with `api_auth.AUTH_FAILURE_NOTE`, read off its
// log's exit record, so the ship stop is not booked as a review finding (joshuafolkken/kit#4216).
function exited_answer(exit_code: number | null, log_path: string): BrokerAnswer {
	const exited = `the reviewer exited with code ${String(exit_code)}`

	if (!api_auth.is_auth_failed_transcript(stamp_file.read_stamp_text(log_path))) {
		return failure(exited)
	}

	return failure(`${api_auth.AUTH_FAILURE_NOTE}: ${exited}`)
}

function reviewer_answer(result: AttachedLaunchResult, log_path: string): BrokerAnswer {
	if (result.kind === 'failed') return failure(`the reviewer could not start: ${result.note}`)

	return result.exit_code === 0 ? SUCCESS : exited_answer(result.exit_code, log_path)
}

async function launch_review(
	lane: LaneInfo,
	action: ReviewAction,
	slot: ReviewSlot,
): Promise<BrokerAnswer> {
	const target = review_paths(lane.directory, slot)
	const prompt = review_prompt(lane, action, slot)
	const built = agent_argv.review_in(prompt, Number(action.round), lane.directory)
	if (built.kind === 'rejected') return failure(`the reviewer profile was rejected: ${built.note}`)

	if (built.profile.provider !== provider_of(lane)) {
		return failure(`the reviewer resolved to ${built.profile.provider}, not the lane's provider`)
	}

	console.error(agent_role_profile.describe_review(Number(action.round), built.profile))
	const result = await detached_launch.launch_attached(
		{
			argv: built.argv,
			cwd: lane.directory,
			log_path: target.log,
			profile: built.profile,
			env: lane_child_marker.env_for(lane.issue),
		},
		console.error,
	)

	return reviewer_answer(result, target.log)
}

// **The slots' reviewers run side by side**, and the answer is the first failure among them — each
// slot's findings file then says which review finished (`run-ship-reviewer.ts`).
async function launch_reviews(lane: LaneInfo, action: ReviewAction): Promise<BrokerAnswer> {
	const answers = await Promise.all(
		action_slots(action).map(async (slot) => await launch_review(lane, action, slot)),
	)

	return answers.find((reply) => !reply.is_success) ?? SUCCESS
}

// An OpenAI lane's successor is its supervisor's to start, never a relaunch's.
async function relaunch(lane: LaneInfo, stop: ShipStop): Promise<BrokerAnswer> {
	if (lane_relaunch.is_openai_lane(lane)) {
		return failure('an OpenAI lane is relaunched by its own supervisor')
	}

	const invocation = lane_child_invocation.ship_stop_invocation(lane.issue, stop)
	const phase = agent_role_profile.IMPLEMENTATION_PHASE
	const result = await lane_relaunch.relaunch(lane, invocation, phase, console.error)

	return result.kind === 'launched'
		? SUCCESS
		: failure(`the relaunch did not start: ${result.note}`)
}

// **A parked issue gets no session**: a request can be read long after it was written, so the park is
// read when the action runs, never when it was asked for (joshuafolkken/kit#3878).
async function perform(lane: LaneInfo, action: BrokerAction): Promise<BrokerAnswer> {
	if (await lane_parked.is_parked(lane.issue)) return failure('the issue is parked')

	if (action.kind === 'relaunch') return await relaunch(lane, action.stop)

	return await launch_reviews(lane, action)
}

// What the server answers: a thrown action is a failure naming its error, never a dead server.
async function answer(lane: LaneInfo, action: BrokerAction): Promise<BrokerAnswer> {
	try {
		return await perform(lane, action)
	} catch (error) {
		return failure(`the broker failed: ${error_text.message_of(error)}`)
	}
}

const lane_session_action = {
	SUCCESS,
	action_schema,
	answer,
	failure,
	request_schema,
	review_paths,
}

export type { BrokerAction, BrokerAnswer, ReviewRound }
export { lane_session_action }
