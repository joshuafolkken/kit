import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { detached_launch, type AttachedLaunchResult } from '#scripts/run/detached-launch'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { run_ship_stop_context } from '#scripts/run/ship/run-ship-stop-context'
import { z } from 'zod'
import { lane_child_invocation, type ShipStop } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_parked } from './lane-parked'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'

// The actions a lane's session broker performs for the ship that asked (`lane-session-broker.ts`):
// starting the round-1 or round-2 reviewer, or relaunching the lane's child after a stopped ship.
// **A failure names its reason**: a bare `false` left every relaunch a stale supervisor refused
// unexplained in the ship log (joshuafolkken/kit#3974).

const BRIEF_PREFIX = 'josh-ship-review-brief-'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'
const LOG_PREFIX = 'josh-ship-review-log-'
const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const stop_schema = z
	.object({
		stage: z.enum(run_ship_stage.STAGE),
		title: z.string(),
		flags: z.array(z.string()).readonly(),
		is_review: z.boolean(),
		conflicts: z.array(z.string()).readonly().default([]),
		is_review_stale: z.boolean().exactOptional(),
		context: run_ship_stop_context.stop_context_schema.exactOptional(),
	})
	.strict()
const action_schema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('review'), round: z.enum(['1', '2']) }).strict(),
	z.object({ kind: z.literal('relaunch'), stop: stop_schema }).strict(),
])
type ReviewRound = Extract<z.infer<typeof action_schema>, { kind: 'review' }>['round']
type BrokerAction = { kind: 'review'; round: ReviewRound } | { kind: 'relaunch'; stop: ShipStop }
type BrokerAnswer = { is_success: true } | { is_success: false; reason: string }

const SUCCESS: BrokerAnswer = { is_success: true }

function failure(reason: string): BrokerAnswer {
	return { is_success: false, reason }
}

function review_paths(directory: string): { brief: string; findings: string; log: string } {
	return {
		brief: stamp_file.stamp_path(BRIEF_PREFIX, directory, '.md'),
		findings: stamp_file.stamp_path(FINDINGS_PREFIX, directory, '.txt'),
		log: stamp_file.stamp_path(LOG_PREFIX, directory, '.log'),
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

function review_prompt(lane: LaneInfo, round: ReviewRound): string {
	const target = review_paths(lane.directory)
	const prompt_of =
		round === '1' ? run_ship_review.reviewer_prompt : run_ship_review.verification_prompt
	const tail = lane_child_invocation.review_invocation(lane.issue)

	return `${prompt_of(target.brief, target.findings, lane.issue)} This is ${tail}`
}

function reviewer_answer(result: AttachedLaunchResult): BrokerAnswer {
	if (result.kind === 'failed') return failure(`the reviewer could not start: ${result.note}`)

	return result.exit_code === 0
		? SUCCESS
		: failure(`the reviewer exited with code ${String(result.exit_code)}`)
}

async function launch_review(lane: LaneInfo, round: ReviewRound): Promise<BrokerAnswer> {
	const target = review_paths(lane.directory)
	const built = agent_argv.review_in(review_prompt(lane, round), Number(round), lane.directory)
	if (built.kind === 'rejected') return failure(`the reviewer profile was rejected: ${built.note}`)

	if (built.profile.provider !== provider_of(lane)) {
		return failure(`the reviewer resolved to ${built.profile.provider}, not the lane's provider`)
	}

	console.error(agent_role_profile.describe_review(Number(round), built.profile))
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

	return reviewer_answer(result)
}

// An OpenAI lane's successor is its supervisor's to start, never a relaunch's.
function relaunch(lane: LaneInfo, stop: ShipStop): BrokerAnswer {
	if (lane_relaunch.is_openai_lane(lane)) {
		return failure('an OpenAI lane is relaunched by its own supervisor')
	}

	const invocation = lane_child_invocation.ship_stop_invocation(lane.issue, stop)
	const phase = agent_role_profile.IMPLEMENTATION_PHASE
	const result = lane_relaunch.relaunch(lane, invocation, phase, console.error)

	return result.kind === 'launched'
		? SUCCESS
		: failure(`the relaunch did not start: ${result.note}`)
}

// **A parked issue gets no session**: a request can be read long after it was written, so the park is
// read when the action runs, never when it was asked for (joshuafolkken/kit#3878).
async function perform(lane: LaneInfo, action: BrokerAction): Promise<BrokerAnswer> {
	if (await lane_parked.is_parked(lane.issue)) return failure('the issue is parked')

	if (action.kind === 'relaunch') return relaunch(lane, action.stop)

	return await launch_review(lane, action.round)
}

// What the server answers: a thrown action is a failure naming its error, never a dead server.
async function answer(lane: LaneInfo, action: BrokerAction): Promise<BrokerAnswer> {
	try {
		return await perform(lane, action)
	} catch (error) {
		return failure(`the broker failed: ${error_text.message_of(error)}`)
	}
}

const lane_session_action = { SUCCESS, action_schema, answer, failure, review_paths }

export type { BrokerAction, BrokerAnswer, ReviewRound }
export { lane_session_action }
