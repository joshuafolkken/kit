import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { issue_cite } from '#scripts/issue/issue-cite'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { z } from 'zod'
import { lane_broker_server, type BrokerServer } from './lane-broker-server'
import type { LaneInfo } from './lane-registry'
import { lane_session_action, type BrokerAction, type BrokerAnswer } from './lane-session-action'

// The sessions a lane child's detached `josh ship` cannot start itself, started for it by a process
// that can: the round-1 and round-2 reviewer, and the fresh child a stopped ship hands back to. An
// OpenAI lane's own supervisor serves it, because a nested Codex cannot write outside its sandbox; a
// Claude lane is served by the `run:wake` supervisor (`claude-lane-broker.ts`), because Claude Code removes its
// token from what its Bash tool starts, so a token-only credential never reaches the ship the child
// launched (joshuafolkken/kit#3817). **The request names an action, never a command**: the server
// rebuilds the argv from the registered lane, so a child can ask for nothing but these two sessions
// (`lane-session-action.ts`).

const REQUEST_PREFIX = '.josh-review-request-'
const RESPONSE_PREFIX = '.josh-review-response-'
const CACHE_DIRECTORY = ['node_modules', '.cache']
const POLL_MS = 100
// The heartbeat is kept for a ship branched before the server record, and read only where a
// supervisor started before it left no such record (`lane-broker-server.ts`).
const LEGACY_HEARTBEAT_MS = 500
const LEGACY_HEARTBEAT_LIMIT_MS = 3000
const MINUTE_MS = 60_000
const REQUEST_LIMIT_MINUTES = 30
const REQUEST_LIMIT_MS = REQUEST_LIMIT_MINUTES * MINUTE_MS
const request_schema = z
	.object({ session: z.uuid(), nonce: z.uuid(), action: lane_session_action.action_schema })
	.strict()
// **A request this broker cannot read is still answered**: the supervisor keeps the code it started
// with while a lane's ship runs a newer main, so a field the ship added made the request unreadable and
// the ship waited out the whole limit on a server that had dropped it (joshuafolkken/kit#4230).
const envelope_schema = z.looseObject({ session: z.uuid(), nonce: z.uuid() })
const UNREADABLE_REASON =
	"the broker could not read the request — the supervisor runs older code than the lane's ship"
const response_schema = z
	.object({
		session: z.uuid(),
		nonce: z.string(),
		is_success: z.boolean(),
		heartbeat_at: z.number().int().positive(),
	})
	.strict()
// **A failure's reason sits beside the response, never in it**: a ship branched before the reason parses
// the response strictly, so a new field would read as no server (joshuafolkken/kit#3974).
const reason_schema = z.object({ nonce: z.string(), reason: z.string() }).strict()
type BrokerEnvelope = z.infer<typeof envelope_schema>
type BrokerResponse = z.infer<typeof response_schema>

const { failure } = lane_session_action

function request_path(directory: string, issue: string): string {
	return path.join(directory, ...CACHE_DIRECTORY, `${REQUEST_PREFIX}${issue}.json`)
}

function response_path(directory: string, issue: string): string | undefined {
	const common = git_common_directory.resolve(directory)
	if (common === undefined || path.basename(common) !== '.git') return undefined

	return path.join(path.dirname(common), ...CACHE_DIRECTORY, `${RESPONSE_PREFIX}${issue}.json`)
}

function reason_path(response: string): string {
	return `${response}.reason`
}

function read_record<T>(target: string, schema: z.ZodType<T>): T | undefined {
	try {
		return json_value.parse_with(readFileSync(target, 'utf8'), schema)
	} catch {
		return undefined
	}
}

function write_record(target: string, body: BrokerResponse | z.infer<typeof reason_schema>): void {
	const temporary = `${target}.${String(process.pid)}.tmp`

	writeFileSync(temporary, JSON.stringify(body))
	renameSync(temporary, target)
}

async function answer_request(lane: LaneInfo, received: BrokerEnvelope): Promise<BrokerAnswer> {
	const parsed = request_schema.safeParse(received)

	return parsed.success
		? await lane_session_action.answer(lane, parsed.data.action)
		: failure(UNREADABLE_REASON)
}

async function process_request(
	lane: LaneInfo,
	response: string,
	received: BrokerEnvelope,
	state: { current: BrokerResponse },
): Promise<void> {
	const answer = await answer_request(lane, received)
	const { session, nonce } = received

	if (!answer.is_success) write_record(reason_path(response), { nonce, reason: answer.reason })
	state.current = { session, nonce, is_success: answer.is_success, heartbeat_at: Date.now() }
	write_record(response, state.current)
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
		const received = read_record(target, envelope_schema)

		if (received?.session === session && received.nonce !== last_nonce) {
			last_nonce = received.nonce
			// eslint-disable-next-line no-await-in-loop -- requests are served one at a time, in arrival order
			await process_request(lane, response, received, state)
		}

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_MS)
	}
}

// The server record is written before the response, so a ship that finds the response finds it too.
function prepare(lane: LaneInfo): { response: string; current: BrokerResponse } {
	const response = response_path(lane.directory, lane.issue)
	if (response === undefined) throw new Error('review broker has no trusted response location')

	const session = randomUUID()

	mkdirSync(path.dirname(response), { recursive: true })
	mkdirSync(path.dirname(request_path(lane.directory, lane.issue)), { recursive: true })
	lane_broker_server.write(response, session)
	const current: BrokerResponse = {
		session,
		nonce: '',
		is_success: false,
		heartbeat_at: Date.now(),
	}

	write_record(response, current)

	return { response, current }
}

function start_heartbeat(state: { current: BrokerResponse }, response: string): NodeJS.Timeout {
	const heartbeat = setInterval(() => {
		state.current = { ...state.current, heartbeat_at: Date.now() }
		write_record(response, state.current)
	}, LEGACY_HEARTBEAT_MS)

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
	rmSync(reason_path(response), { force: true })
	lane_broker_server.remove(response)
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

function is_fresh_heartbeat(heartbeat_at: number): boolean {
	const now = Date.now()

	return heartbeat_at <= now && heartbeat_at >= now - LEGACY_HEARTBEAT_LIMIT_MS
}

// Live by the server record (`lane-broker-server.ts`); a response with none was written by a
// supervisor started before it, read by the heartbeat that supervisor still writes.
function is_live_response(
	target: string,
	response: BrokerResponse | undefined,
	is_live: (server: BrokerServer) => boolean,
): response is BrokerResponse {
	if (response === undefined) return false

	const server = lane_broker_server.read(target, response.session)

	return server === undefined ? is_fresh_heartbeat(response.heartbeat_at) : is_live(server)
}

function session_response(target: string, session: string): BrokerResponse | undefined {
	const response = read_record(target, response_schema)

	return response?.session === session ? response : undefined
}

// A failure from a server that predates the reason leaves none.
function answer_of(target: string, response: BrokerResponse): BrokerAnswer {
	if (response.is_success) return lane_session_action.SUCCESS

	const record = read_record(reason_path(target), reason_schema)
	const reason = record?.nonce === response.nonce ? record.reason : 'it gave no reason'

	return failure(`the broker answered a failure: ${reason}`)
}

// The server's answer to this request, or `undefined` while it is still being served.
function response_verdict(
	target: string,
	session: string,
	nonce: string,
): BrokerAnswer | undefined {
	const response = session_response(target, session)

	if (!is_live_response(target, response, lane_broker_server.is_running)) {
		return failure('the broker stopped serving before it answered')
	}

	return response.nonce === nonce ? answer_of(target, response) : undefined
}

async function wait_response(
	target: string,
	session: string,
	nonce: string,
): Promise<BrokerAnswer> {
	const deadline = Date.now() + REQUEST_LIMIT_MS

	while (Date.now() < deadline) {
		const verdict = response_verdict(target, session, nonce)
		if (verdict !== undefined) return verdict

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_MS)
	}

	return failure(`the broker gave no answer within ${String(REQUEST_LIMIT_MINUTES)} minutes`)
}

function live_response(target: string): BrokerResponse | undefined {
	const response = read_record(target, response_schema)

	return is_live_response(target, response, lane_broker_server.is_serving_process)
		? response
		: undefined
}

// Whether a server answers for this lane now — what a Claude lane's ship asks before it hands a session
// over rather than starting the session itself.
function is_serving(directory: string, issue: string): boolean {
	const target = response_path(directory, issue)

	return target !== undefined && live_response(target) !== undefined
}

// **A request nobody waits for any more is taken back**: a server busy with an earlier request reads the
// file only once it is free, and a relaunch the ship had already given up on then started a session in a
// lane the run had parked in the meantime (joshuafolkken/kit#3878). A newer request is left alone.
function withdraw(pending: string, nonce: string): void {
	if (read_record(pending, request_schema)?.nonce === nonce) stamp_file.remove_stamp(pending)
}

// A failure is put on the run's stream as well as the ship's output, so a broker that cannot serve the
// lane is seen from `run:board` rather than only from the ship log (joshuafolkken/kit#4230).
async function record_failure(issue: string, answer: BrokerAnswer): Promise<void> {
	if (answer.is_success) return

	const text = `${issue_cite.plain(issue)} lane broker: ${answer.reason}`

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, text)
}

async function send(directory: string, issue: string, action: BrokerAction): Promise<BrokerAnswer> {
	const target = response_path(directory, issue)
	const response = target === undefined ? undefined : live_response(target)

	if (target === undefined || response === undefined) return failure('no broker serves this lane')

	const nonce = randomUUID()
	const body = { session: response.session, nonce, action }
	const pending = request_path(directory, issue)

	stamp_file.replace_stamp(pending, body)
	const answer = await wait_response(target, response.session, nonce)

	withdraw(pending, nonce)

	return answer
}

async function request(
	directory: string,
	issue: string,
	action: BrokerAction,
): Promise<BrokerAnswer> {
	const answer = await send(directory, issue, action)

	await record_failure(issue, answer)

	return answer
}

const lane_session_broker = {
	is_serving,
	request,
	request_path,
	response_path,
	review_paths: lane_session_action.review_paths,
	with_server,
}

export { lane_session_broker }

export { type ReviewRound, type BrokerAction, type BrokerAnswer } from './lane-session-action'
