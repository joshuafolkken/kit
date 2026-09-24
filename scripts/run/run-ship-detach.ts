import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch, type LaunchArgv } from './detached-launch'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// `josh ship --detach` — hand the post-implementation region to a supervisor that outlives the agent
// (joshuafolkken/kit#2428). A lane child used to take the pre-gate cut and relaunch a fresh agent session
// to drive the gate, the review and the merge; that session re-read the issue to run fixed procedure,
// and the wake role it billed was 59.8% of a run's wall time. This starts `josh ship` itself as a
// detached process instead, so the agent ends at the hand-off and nothing but the mechanical region runs.
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
const SUPERVISED_VALUE = '1'
const LAUNCHED = 'launched'
const BUSY = 'busy'
const FAILED = 'failed'
const NO_SIGNAL = 0
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

function is_alive(pid: number): boolean {
	try {
		process.kill(pid, NO_SIGNAL)

		return true
	} catch (error) {
		return error instanceof Error && 'code' in error && error.code === 'EPERM'
	}
}

// The recorded supervisor, when it is still running. An absent, unreadable or dead pid is no supervisor.
function is_supervisor_running(pid_target: string): boolean {
	const pid = Number(stamp_file.read_stamp_text(pid_target)?.trim())

	return Number.isSafeInteger(pid) && pid > 0 && is_alive(pid)
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

function launch(request: DetachRequest): DetachResult {
	const notes: Array<string> = []
	const log = log_path(request.repository, request.number)
	const result = detached_launch.launch(
		{
			argv: supervisor_argv(request),
			cwd: request.cwd,
			log_path: log,
			// The provider travels as a mark because the launch strips the session keys that name it, and
			// `ship --review` resolves its reviewer from it (joshuafolkken/kit#2456).
			env: { ...agent_role_profile.handoff_environment(), [SUPERVISED_KEY]: SUPERVISED_VALUE },
		},
		(note) => {
			notes.push(note)
		},
	)

	if (result.kind === 'failed') return { verdict: FAILED, note: result.note }

	stamp_file.write_text_stamp(key(PID_PREFIX, request), String(result.pid))

	return {
		verdict: LAUNCHED,
		note: [`supervisor ${String(result.pid)} — log: ${log}`, ...notes].join('\n'),
	}
}

async function detach(request: DetachRequest): Promise<DetachResult> {
	if (is_supervisor_running(key(PID_PREFIX, request))) {
		return { verdict: BUSY, note: `a ship supervisor for #${request.number} is already running` }
	}

	const result = launch(request)

	if (result.verdict === LAUNCHED) {
		await run_event_stream_emit.emit(
			run_event_stream.EVENT_KIND.SHIP_LAUNCH,
			`#${request.number} ship supervisor launched`,
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
