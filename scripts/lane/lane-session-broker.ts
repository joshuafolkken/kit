import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { z } from 'zod'
import { lane_child_invocation, type ShipStop } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'

// The sessions a lane child's detached `josh ship` cannot start itself, started for it by a process
// that can: the round-1 and round-2 reviewer, and the fresh child a stopped ship hands back to. An
// OpenAI lane's own supervisor serves it, because a nested Codex cannot write outside its sandbox; a
// Claude lane is served by the `run:wake` supervisor (`claude-lane-broker.ts`), because Claude Code removes its
// token from what its Bash tool starts, so a token-only credential never reaches the ship the child
// launched (joshuafolkken/kit#3817). **The request names an action, never a command**: the server
// rebuilds the argv from the registered lane, so a child can ask for nothing but these two sessions.

const REQUEST_PREFIX = '.josh-review-request-'
const RESPONSE_PREFIX = '.josh-review-response-'
const BRIEF_PREFIX = 'josh-ship-review-brief-'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'
const LOG_PREFIX = 'josh-ship-review-log-'
const CACHE_DIRECTORY = ['node_modules', '.cache']
const POLL_MS = 100
const HEARTBEAT_MS = 500
const HEARTBEAT_LIMIT_MS = 3000
const MINUTE_MS = 60_000
const REQUEST_LIMIT_MINUTES = 30
const REQUEST_LIMIT_MS = REQUEST_LIMIT_MINUTES * MINUTE_MS
const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const stop_schema = z
	.object({
		stage: z.enum(run_ship_stage.STAGE),
		title: z.string(),
		flags: z.array(z.string()).readonly(),
		is_review: z.boolean(),
		conflicts: z.array(z.string()).readonly().default([]),
	})
	.strict()
const action_schema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('review'), round: z.enum(['1', '2']) }).strict(),
	z.object({ kind: z.literal('relaunch'), stop: stop_schema }).strict(),
])
const request_schema = z
	.object({ session: z.uuid(), nonce: z.uuid(), action: action_schema })
	.strict()
const response_schema = z
	.object({
		session: z.uuid(),
		nonce: z.string(),
		is_success: z.boolean(),
		heartbeat_at: z.number().int().positive(),
	})
	.strict()
type BrokerRequest = z.infer<typeof request_schema>
type BrokerResponse = z.infer<typeof response_schema>
type ReviewRound = Extract<z.infer<typeof action_schema>, { kind: 'review' }>['round']
type BrokerAction = { kind: 'review'; round: ReviewRound } | { kind: 'relaunch'; stop: ShipStop }

function review_paths(directory: string): { brief: string; findings: string; log: string } {
	return {
		brief: stamp_file.stamp_path(BRIEF_PREFIX, directory, '.md'),
		findings: stamp_file.stamp_path(FINDINGS_PREFIX, directory, '.txt'),
		log: stamp_file.stamp_path(LOG_PREFIX, directory, '.log'),
	}
}

function request_path(directory: string, issue: string): string {
	return path.join(directory, ...CACHE_DIRECTORY, `${REQUEST_PREFIX}${issue}.json`)
}

function response_path(directory: string, issue: string): string | undefined {
	const common = git_common_directory.resolve(directory)
	if (common === undefined || path.basename(common) !== '.git') return undefined

	return path.join(path.dirname(common), ...CACHE_DIRECTORY, `${RESPONSE_PREFIX}${issue}.json`)
}

function read_record<T>(target: string, schema: z.ZodType<T>): T | undefined {
	try {
		return json_value.parse_with(readFileSync(target, 'utf8'), schema)
	} catch {
		return undefined
	}
}

// The reviewer runs on the lane's own provider, so a Claude lane's server never starts a Codex reviewer
// and an OpenAI lane's never starts a Claude one.
function provider_of(lane: LaneInfo): AgentProvider {
	return lane.profile?.provider ?? ANTHROPIC_PROVIDER
}

// **The reviewer carries the lane's mark explicitly**: the supervisor serving a Claude lane is no lane child,
// so a reviewer inheriting its environment would descend from the carry record's owner unmarked and be
// read as the `backlogrun` parent by every hook.

async function launch_review(lane: LaneInfo, round: ReviewRound): Promise<boolean> {
	const target = review_paths(lane.directory)
	const prompt_of =
		round === '1' ? run_ship_review.reviewer_prompt : run_ship_review.verification_prompt
	const built = agent_argv.resolve_in(
		prompt_of(target.brief, target.findings),
		agent_role_profile.REVIEWER,
		lane.directory,
	)
	if (built.kind === 'rejected' || built.profile.provider !== provider_of(lane)) return false

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

	return result.kind === 'completed' && result.exit_code === 0
}

// An OpenAI lane's successor is its supervisor's to start, never a relaunch's.
function relaunch(lane: LaneInfo, stop: ShipStop): boolean {
	if (lane_relaunch.is_openai_lane(lane)) return false

	const invocation = lane_child_invocation.ship_stop_invocation(lane.issue, stop)
	const phase = agent_role_profile.IMPLEMENTATION_PHASE
	const result = lane_relaunch.relaunch(lane, invocation, phase, console.error)

	return result.kind === 'launched'
}

async function perform(lane: LaneInfo, action: BrokerAction): Promise<boolean> {
	if (action.kind === 'relaunch') return relaunch(lane, action.stop)

	return await launch_review(lane, action.round)
}

function write_response(target: string, body: BrokerResponse): void {
	const temporary = `${target}.${String(process.pid)}.tmp`

	writeFileSync(temporary, JSON.stringify(body))
	renameSync(temporary, target)
}

async function launched(lane: LaneInfo, action: BrokerAction): Promise<boolean> {
	try {
		return await perform(lane, action)
	} catch (error) {
		error_text.trace_swallowed('lane_session_broker.launched', error)

		return false
	}
}

async function process_request(
	lane: LaneInfo,
	response: string,
	received: BrokerRequest,
	state: { current: BrokerResponse },
): Promise<void> {
	const is_success = await launched(lane, received.action)

	state.current = {
		session: received.session,
		nonce: received.nonce,
		is_success,
		heartbeat_at: Date.now(),
	}
	write_response(response, state.current)
}

async function serve(
	lane: LaneInfo,
	session: string,
	response: string,
	state: { is_running: boolean; current: BrokerResponse },
): Promise<void> {
	let last_nonce = ''
	const target = request_path(lane.directory, lane.issue)

	while (state.is_running) {
		const received = read_record(target, request_schema)

		if (received?.session === session && received.nonce !== last_nonce) {
			last_nonce = received.nonce
			// eslint-disable-next-line no-await-in-loop -- requests are served one at a time, in arrival order
			await process_request(lane, response, received, state)
		}

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_MS)
	}
}

function prepare(lane: LaneInfo): { response: string; current: BrokerResponse } {
	const response = response_path(lane.directory, lane.issue)
	if (response === undefined) throw new Error('review broker has no trusted response location')

	const session = randomUUID()

	mkdirSync(path.dirname(response), { recursive: true })
	mkdirSync(path.dirname(request_path(lane.directory, lane.issue)), { recursive: true })
	const current: BrokerResponse = {
		session,
		nonce: '',
		is_success: false,
		heartbeat_at: Date.now(),
	}

	write_response(response, current)

	return { response, current }
}

function start_heartbeat(state: { current: BrokerResponse }, response: string): NodeJS.Timeout {
	const heartbeat = setInterval(() => {
		state.current = { ...state.current, heartbeat_at: Date.now() }
		write_response(response, state.current)
	}, HEARTBEAT_MS)

	heartbeat.unref()

	return heartbeat
}

// **The heartbeat outlives the request being served.** A ship waiting on a reviewer reads a stale
// heartbeat as a dead server, so stopping it first would fail a review the server is still running.
async function stop_server(
	state: { is_running: boolean },
	heartbeat: NodeJS.Timeout,
	serving: Promise<void>,
	response: string,
): Promise<void> {
	state.is_running = false
	await serving
	clearInterval(heartbeat)
	unlinkSync(response)
}

async function with_server<T>(lane: LaneInfo, run: () => Promise<T>): Promise<T> {
	const { response, current } = prepare(lane)
	const state = { is_running: true, current }
	const heartbeat = start_heartbeat(state, response)
	const serving = serve(lane, current.session, response, state)

	try {
		return await run()
	} finally {
		await stop_server(state, heartbeat, serving, response)
	}
}

function is_live_response(
	response: BrokerResponse | undefined,
	session: string,
): response is BrokerResponse {
	const now = Date.now()

	return (
		response?.session === session &&
		response.heartbeat_at <= now &&
		response.heartbeat_at >= now - HEARTBEAT_LIMIT_MS
	)
}

function response_verdict(
	response: BrokerResponse | undefined,
	session: string,
	nonce: string,
): 'wait' | 'success' | 'failure' {
	if (!is_live_response(response, session)) return 'failure'
	if (response.nonce !== nonce) return 'wait'

	return response.is_success ? 'success' : 'failure'
}

async function wait_response(target: string, session: string, nonce: string): Promise<boolean> {
	const deadline = Date.now() + REQUEST_LIMIT_MS

	while (Date.now() < deadline) {
		const verdict = response_verdict(read_record(target, response_schema), session, nonce)
		if (verdict !== 'wait') return verdict === 'success'

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_MS)
	}

	return false
}

function live_response(target: string): BrokerResponse | undefined {
	const response = read_record(target, response_schema)

	return is_live_response(response, response?.session ?? '') ? response : undefined
}

// Whether a server answers for this lane now — what a Claude lane's ship asks before it hands a session
// over rather than starting the session itself.
function is_serving(directory: string, issue: string): boolean {
	const target = response_path(directory, issue)

	return target !== undefined && live_response(target) !== undefined
}

async function request(directory: string, issue: string, action: BrokerAction): Promise<boolean> {
	const target = response_path(directory, issue)
	const response = target === undefined ? undefined : live_response(target)

	if (target === undefined || response === undefined) return false

	const nonce = randomUUID()
	const body = { session: response.session, nonce, action }

	stamp_file.replace_stamp(request_path(directory, issue), body)

	return await wait_response(target, response.session, nonce)
}

const lane_session_broker = {
	is_serving,
	request,
	request_path,
	response_path,
	review_paths,
	with_server,
}

export type { BrokerAction, ReviewRound }
export { lane_session_broker }
