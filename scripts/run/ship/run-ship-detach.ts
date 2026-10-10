import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { detached_launch, type LaunchArgv } from '#scripts/run/detached-launch'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { z } from 'zod'

// `josh ship --detach` — hand the post-implementation region to a supervisor that outlives the agent.
// This starts `josh ship` itself as a detached process, so the agent ends at the hand-off and nothing
// but the mechanical region runs.
//
// **The supervisor's command line ends with the `"<title> #<N>"` title**, which is what the parent's
// liveness pattern (`lane-child-invocation.ts`) anchors on — so a lane whose agent has ended is still
// booked alive while its supervisor ships it. The follow-up citations therefore travel as `--cite`
// options rather than trailing positionals, and an inline notify body — whose newlines no argv element
// may carry — is written to a file and passed as `--notify-message-file`.
//
// **One supervisor per issue.** The launched pid is kept beside the stage record, and a second detach
// while that process is alive is refused `busy`: two supervisors would race each other's commit and
// merge, which the resume record (`run-ship-stage.ts`) orders but cannot serialize.
//
// **The supervisor names itself once it starts**. The launcher reads the child's
// start time from outside, which a sandbox that refuses `ps` cannot answer; a pid with no start time
// would then be believed for as long as any process holds that number. The supervisor therefore claims
// the record with its own identity — whose socket beacon answers where `ps` cannot — and a record still
// carrying a bare pid is believed only for the claim window after its launch. A recorded start time the
// probe cannot momentarily read is the opposite case: the pid is alive and was verified once, so it is
// kept running rather than read as a crash that would license a second supervisor.

const LOG_PREFIX = 'josh-ship-log-'
const PID_PREFIX = 'josh-ship-pid-'
const BODY_PREFIX = 'josh-ship-notify-'
const KEY_SEPARATOR = '-'
const LOG_SUFFIX = '.log'
const BODY_SUFFIX = '.txt'
const PNPM = 'pnpm'
const INLINE_NOTIFY = '--notify-message'
const FILE_NOTIFY = '--notify-message-file'
const NOTIFY_VALUE_INDEX = 1
// Set on the supervisor so it knows a failed stage is its to hand back (`run-ship-return.ts`); a ship run
// in an agent's own turn reports its failure in that turn and hands nothing back.
const SUPERVISED_KEY = 'JOSH_SHIP_SUPERVISED'
const LAUNCH_ID_KEY = 'JOSH_SHIP_LAUNCH_ID'
const SUPERVISED_VALUE = '1'
const LAUNCHED = 'launched'
const BUSY = 'busy'
const FAILED = 'failed'
const RESULT_PREFIX = 'josh-ship-result-'
const RECORD_POLL_MS = 25
const RECORD_WAIT_ATTEMPTS = 200
// How long a bare launched pid is believed before the supervisor must have claimed the record: far above
// a `pnpm josh ship` start-up, far below the lifetime a reused pid could otherwise be believed for.
const CLAIM_WINDOW_MS = 120_000
type ShipResult = 'running' | 'success' | 'failed' | 'abnormal'

interface ShipRecord {
	pid?: number | undefined
	process_start?: string | undefined
	launched_at?: number | undefined
	launcher_pid?: number | undefined
	launcher_start?: string | undefined
	launch_id: string
	result?: 'success' | 'failed' | undefined
}

const ship_record_schema = z.object({
	pid: z.number().int().positive().optional(),
	process_start: z.string().optional(),
	launched_at: z.number().optional(),
	launcher_pid: z.number().int().positive().optional(),
	launcher_start: z.string().optional(),
	launch_id: z.string(),
	result: z.enum(['success', 'failed']).optional(),
})

// `detached_launch.log_header`'s shape — `\n=== <time> · started by process <pid> · <command> ===` — read
// back to find where the last launch into the log began.
const LAUNCH_MARK = ' · started by process '
const HEADER_START = '\n'

interface DetachRequest {
	title: string
	number: string
	notify: ReadonlyArray<string>
	body: ReadonlyArray<string>
	cites: ReadonlyArray<string>
	is_review: boolean
	repository: string
	cwd: string
}

interface DetachResult {
	verdict: typeof LAUNCHED | typeof BUSY | typeof FAILED
	note: string
}

function key(prefix: string, request: Pick<DetachRequest, 'number' | 'repository'>): string {
	return stamp_file.stamp_path(`${prefix}${request.number}${KEY_SEPARATOR}`, request.repository)
}

function log_path(repository: string, number: string): string {
	return stamp_file.stamp_path(`${LOG_PREFIX}${number}${KEY_SEPARATOR}`, repository, LOG_SUFFIX)
}

function result_path(repository: string, number: string): string {
	return stamp_file.stamp_path(`${RESULT_PREFIX}${number}${KEY_SEPARATOR}`, repository)
}

function read_record(repository: string, number: string): ShipRecord | undefined {
	try {
		const raw = stamp_file.read_stamp_text(result_path(repository, number))

		return raw === undefined ? undefined : json_value.parse_with(raw, ship_record_schema)
	} catch {
		return undefined
	}
}

function record_launch(request: DetachRequest, pid: number, launch_id: string): void {
	stamp_file.write_text_stamp(key(PID_PREFIX, request), String(pid))
	const process_start = process_identity.read_start(pid)

	stamp_file.replace_stamp(result_path(request.repository, request.number), {
		pid,
		launch_id,
		launched_at: Date.now(),
		...(process_start !== undefined && { process_start }),
	})
}

function supervisor_environment(launch_id: string): Record<string, string | undefined> {
	return {
		...agent_role_profile.handoff_environment(),
		[SUPERVISED_KEY]: SUPERVISED_VALUE,
		[LAUNCH_ID_KEY]: launch_id,
	}
}

function is_within_claim_window(record: ShipRecord): boolean {
	return record.launched_at !== undefined && Date.now() - record.launched_at < CLAIM_WINDOW_MS
}

function has_live_identity(pid: number, record: ShipRecord): boolean {
	if (record.process_start === undefined) {
		return is_within_claim_window(record) && process_identity.is_live_pid(pid)
	}

	return process_identity.is_same_process(pid, record.process_start) !== false
}

function result_of(record: ShipRecord): ShipResult {
	if (record.pid === undefined) {
		const is_launcher = process_identity.is_same_process(record.launcher_pid, record.launcher_start)

		return is_launcher === false ? 'abnormal' : 'running'
	}

	if (has_live_identity(record.pid, record)) return 'running'

	return record.result ?? 'abnormal'
}

function read_result(
	repository: string,
	number: string,
): { launch_id: string; result: ShipResult } | undefined {
	const record = read_record(repository, number)

	return record === undefined
		? undefined
		: { launch_id: record.launch_id, result: result_of(record) }
}

function current_record(repository: string, number: string): ShipRecord | undefined {
	const record = read_record(repository, number)

	return record?.launch_id === process.env[LAUNCH_ID_KEY] ? record : undefined
}

function is_pending(record: ShipRecord | undefined): boolean {
	return record !== undefined && record.pid === undefined
}

async function ready_record(repository: string, number: string): Promise<ShipRecord | undefined> {
	let record = current_record(repository, number)

	for (let attempt = 0; attempt < RECORD_WAIT_ATTEMPTS; attempt += 1) {
		if (!is_pending(record)) return record

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(RECORD_POLL_MS)
		record = current_record(repository, number)
	}

	return undefined
}

async function update_record(
	repository: string,
	number: string,
	fields: Partial<ShipRecord>,
): Promise<void> {
	const record = await ready_record(repository, number)
	if (record === undefined) return

	stamp_file.replace_stamp(result_path(repository, number), { ...record, ...fields })
}

async function mark_result(repository: string, number: string, code: number): Promise<void> {
	await update_record(repository, number, { result: code === 0 ? 'success' : 'failed' })
}

// A supervisor that cannot name its own start either (no probe and no beacon) leaves the launcher's
// identity in place rather than pairing its own pid with the launcher-read start of another process.
async function claim_identity(repository: string, number: string): Promise<void> {
	const own = process_identity.own_fields()
	if (own.process_start === undefined) return

	await update_record(repository, number, own)
}

function failed_launch(request: DetachRequest, note: string): DetachResult {
	stamp_file.remove_stamp(result_path(request.repository, request.number))

	return { verdict: FAILED, note }
}

// The notify tail the supervisor is given: an inline body moved into a file, a file body passed as is.
function notify_arguments(request: DetachRequest): ReadonlyArray<string> {
	const [flag, value] = [request.notify[0], request.notify[NOTIFY_VALUE_INDEX]]

	if (flag !== INLINE_NOTIFY || value === undefined) return request.notify

	const body_path = stamp_file.stamp_path(
		`${BODY_PREFIX}${request.number}${KEY_SEPARATOR}`,
		request.repository,
		BODY_SUFFIX,
	)

	stamp_file.write_text_stamp(body_path, value)

	return [FILE_NOTIFY, body_path]
}

function supervisor_argv(request: DetachRequest): LaunchArgv {
	const review = request.is_review ? ['--review'] : []
	const cites = request.cites.flatMap((cite) => ['--cite', cite])

	return {
		command: PNPM,
		args: [
			'josh',
			'ship',
			...review,
			...notify_arguments(request),
			...request.body,
			...cites,
			request.title,
		],
	}
}

function prepare_launch(request: DetachRequest): string {
	const launch_id = randomUUID()
	const launcher = process_identity.own_fields()

	stamp_file.replace_stamp(result_path(request.repository, request.number), {
		launch_id,
		launcher_pid: launcher.pid,
		...(launcher.process_start !== undefined && { launcher_start: launcher.process_start }),
	})

	return launch_id
}

function launch(request: DetachRequest): DetachResult {
	const notes: Array<string> = []
	const log = log_path(request.repository, request.number)
	const launch_id = prepare_launch(request)
	const result = detached_launch.launch(
		{
			argv: supervisor_argv(request),
			cwd: request.cwd,
			log_path: log,
			// The provider travels as a mark because the launch strips the session keys that name it, and
			// `ship --review` resolves its reviewer from it.
			env: supervisor_environment(launch_id),
		},
		(note) => {
			notes.push(note)
		},
	)

	agent_role_profile.warn_of_default()
	if (result.kind === 'failed') return failed_launch(request, result.note)

	record_launch(request, result.pid, launch_id)

	return {
		verdict: LAUNCHED,
		note: [`supervisor ${String(result.pid)} — log: ${log}`, ...notes].join('\n'),
	}
}

async function detach(request: DetachRequest): Promise<DetachResult> {
	if (read_result(request.repository, request.number)?.result === 'running') {
		return {
			verdict: BUSY,
			note: `a ship supervisor for ${session_cite.issue(request.number)} is already running`,
		}
	}

	const result = launch(request)

	if (result.verdict === LAUNCHED) {
		await run_event_stream_emit.emit(
			run_event_stream.EVENT_KIND.SHIP_LAUNCH,
			`${issue_cite.plain(request.number)} ship supervisor launched`,
		)
	}

	return result
}

// The supervisor log carries every launch into it under `detached_launch`'s header; the report a stopped
// supervisor left is the last launch's, so that is what `josh ship --log` prints.
function last_launch(text: string): string {
	const mark = text.lastIndexOf(LAUNCH_MARK)

	if (mark === -1) return text

	return text.slice(text.lastIndexOf(HEADER_START, mark) + HEADER_START.length)
}

function read_log(repository: string, number: string): string | undefined {
	const text = stamp_file.read_stamp_text(log_path(repository, number))

	return text === undefined ? undefined : last_launch(text)
}

function is_supervised(source: NodeJS.ProcessEnv = process.env): boolean {
	return source[SUPERVISED_KEY] === SUPERVISED_VALUE
}

const run_ship_detach = {
	BUSY,
	FAILED,
	LAUNCHED,
	LAUNCH_ID_KEY,
	claim_identity,
	mark_result,
	read_result,
	SUPERVISED_KEY,
	detach,
	is_supervised,
	last_launch,
	log_path,
	read_log,
	supervisor_argv,
}

export type { DetachRequest, DetachResult }
export { run_ship_detach }
