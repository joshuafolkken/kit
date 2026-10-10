import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { z } from 'zod'
import type { LaneInfo } from './lane-registry'

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
const request_schema = z
	.object({ session: z.uuid(), nonce: z.uuid(), round: z.enum(['1', '2']) })
	.strict()
const response_schema = z
	.object({
		session: z.uuid(),
		nonce: z.string(),
		is_success: z.boolean(),
		heartbeat_at: z.number().int().positive(),
	})
	.strict()
type ReviewRequest = z.infer<typeof request_schema>
type ReviewResponse = z.infer<typeof response_schema>
type ReviewRound = ReviewRequest['round']

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

async function launch_review(lane: LaneInfo, round: ReviewRound): Promise<boolean> {
	const target = review_paths(lane.directory)
	const prompt_of =
		round === '1' ? run_ship_review.reviewer_prompt : run_ship_review.verification_prompt
	const built = agent_argv.resolve_in(
		prompt_of(target.brief, target.findings),
		agent_role_profile.REVIEWER,
		lane.directory,
	)
	if (built.kind === 'rejected' || built.profile.provider !== 'openai') return false

	const result = await detached_launch.launch_attached(
		{
			argv: built.argv,
			cwd: lane.directory,
			log_path: target.log,
			profile: built.profile,
		},
		console.error,
	)

	return result.kind === 'completed' && result.exit_code === 0
}

function write_response(target: string, body: z.infer<typeof response_schema>): void {
	const temporary = `${target}.${String(process.pid)}.tmp`

	writeFileSync(temporary, JSON.stringify(body))
	renameSync(temporary, target)
}

async function launched(lane: LaneInfo, round: ReviewRound): Promise<boolean> {
	try {
		return await launch_review(lane, round)
	} catch (error) {
		error_text.trace_swallowed('openai_review_broker.launched', error)

		return false
	}
}

async function process_request(
	lane: LaneInfo,
	response: string,
	received: ReviewRequest,
	state: { current: ReviewResponse },
): Promise<void> {
	const is_success = await launched(lane, received.round)

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
	state: { is_running: boolean; current: ReviewResponse },
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

function prepare(lane: LaneInfo): { response: string; current: ReviewResponse } {
	const response = response_path(lane.directory, lane.issue)
	if (response === undefined) throw new Error('review broker has no trusted response location')

	const session = randomUUID()

	mkdirSync(path.dirname(response), { recursive: true })
	mkdirSync(path.dirname(request_path(lane.directory, lane.issue)), { recursive: true })
	const current: ReviewResponse = {
		session,
		nonce: '',
		is_success: false,
		heartbeat_at: Date.now(),
	}

	write_response(response, current)

	return { response, current }
}

function start_heartbeat(state: { current: ReviewResponse }, response: string): NodeJS.Timeout {
	const heartbeat = setInterval(() => {
		state.current = { ...state.current, heartbeat_at: Date.now() }
		write_response(response, state.current)
	}, HEARTBEAT_MS)

	heartbeat.unref()

	return heartbeat
}

async function stop_server(
	state: { is_running: boolean },
	heartbeat: NodeJS.Timeout,
	serving: Promise<void>,
	response: string,
): Promise<void> {
	clearInterval(heartbeat)
	state.is_running = false
	await serving
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
	response: ReviewResponse | undefined,
	session: string,
): response is ReviewResponse {
	const now = Date.now()

	return (
		response?.session === session &&
		response.heartbeat_at <= now &&
		response.heartbeat_at >= now - HEARTBEAT_LIMIT_MS
	)
}

function response_verdict(
	response: ReviewResponse | undefined,
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

async function request(directory: string, issue: string, round: ReviewRound): Promise<boolean> {
	const target = response_path(directory, issue)
	if (target === undefined) return false
	const response = read_record(target, response_schema)

	if (response === undefined || !is_live_response(response, response.session)) return false

	const nonce = randomUUID()
	const body: ReviewRequest = { session: response.session, nonce, round }

	stamp_file.replace_stamp(request_path(directory, issue), body)

	return await wait_response(target, response.session, nonce)
}

const openai_review_broker = { request, request_path, response_path, review_paths, with_server }

export { openai_review_broker }
