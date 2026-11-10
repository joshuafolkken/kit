import { execFileSync, spawn } from 'node:child_process'
import {
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
	writeSync,
} from 'node:fs'
import { Socket } from 'node:net'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { error_text } from '#scripts/lib/error-message'
import { hook_daemon_call, type CallAnswer, type DaemonOrigin } from '#tools/hooks/hook-daemon-call'

// The resident `pretool-guard` of one checkout and launch environment (joshuafolkken/kit#6683):
// `scripts/hooks/run-hook.sh` hands it each call through files and FIFOs in its directory instead of
// starting node, and falls back to that node launch whenever it gets no answer. The directory holds
// `pid` and the `requests` FIFO; each request line names a call directory holding `payload`, `cwd`
// (the call's launch directory), `launcher` (the launcher's pid) and the `reply` FIFO, beside which `out` and `err` are written before
// the call's exit status is replied. Calls are answered one at a time, each under the environment
// and root this process started with (`hook-daemon-call.ts`). Bundles that are no longer fresh, or
// were rebuilt since this process loaded them, are never answered from: the call is replied `stale`
// for the launcher to run itself, and the daemon goes, so the next call starts one on the new build.
// So does an idle daemon. An installed package's launcher hands its calls to the daemon the same way.
//
// Built into `dist/hooks/` and run from source in tests: both sit two levels under the package.

const DAEMON_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.join(path.dirname(DAEMON_SCRIPT), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const DETACH_FLAG = '--detach'
const REQUESTS_NAME = 'requests'
const PID_NAME = 'pid'
const LAUNCHER_NAME = 'launcher'
const STALE_REPLY = 'stale'
const MINUTE_MS = 60_000
const IDLE_MINUTES = 15
const CLOSE_GRACE_MS = 1000
// Distinct flag bits, so their sum is the flags combined.
const REPLY_FLAGS = constants.O_WRONLY + constants.O_NONBLOCK
const REQUESTS_FLAGS = constants.O_RDWR + constants.O_NONBLOCK
// `process.argv` is node, this script, then the optional detach flag and the daemon directory.
const ARGUMENTS_START = 2

type Answer = (
	raw_payload: string,
	launch_directory: string,
	launcher_pid: number,
) => Promise<CallAnswer>

interface DaemonOptions {
	readonly answer?: Answer
	readonly is_current?: () => boolean
	readonly idle_ms?: number
}

interface Daemon {
	readonly directory: string
	readonly answer: Answer
	readonly is_current: () => boolean
	readonly idle_ms: number
	readonly input: Socket
	readonly lines: Interface
	idle: NodeJS.Timeout | undefined
	is_closing: boolean
}

function stamp_text(out_directory: string): string {
	const stamp_path = path.join(out_directory, hook_bundle_stamp.STAMP_NAME)

	return existsSync(stamp_path) ? readFileSync(stamp_path, 'utf8') : ''
}

function is_installed(package_directory: string): boolean {
	return package_directory.split(path.sep).includes('node_modules')
}

// What the launch gate (`hook-bundle-fast.ts`) checks before running a bundle, and that the build
// this process loaded is still the one in place. An installed package ships no sources to check
// (joshuafolkken/kit#6962), so there only the build in place counts: a reinstall rewrites its stamp.
function bundle_currency(out_directory: string, package_directory: string): () => boolean {
	const loaded = stamp_text(out_directory)
	const is_built_fresh = is_installed(package_directory)
		? (): boolean => true
		: (): boolean => hook_bundle_stamp.is_fresh(out_directory, package_directory)

	return function is_current(): boolean {
		return is_built_fresh() && stamp_text(out_directory) === loaded
	}
}

function own_answer(): Answer {
	const origin: DaemonOrigin = { root: process.cwd(), environment: { ...process.env } }

	return async (raw_payload, launch_directory, launcher_pid) =>
		await hook_daemon_call.answer(origin, raw_payload, launch_directory, launcher_pid)
}

// Non-blocking, so a caller that already gave up costs nothing: with no reader the open fails.
function reply(request: string, text: string): void {
	try {
		const descriptor = openSync(path.join(request, 'reply'), REPLY_FLAGS)

		writeSync(descriptor, `${text}\n`)
		closeSync(descriptor)
	} catch (error) {
		error_text.trace_swallowed('hook_daemon.reply', error)
	}
}

function is_own_directory(directory: string): boolean {
	const pid_path = path.join(directory, PID_NAME)

	return existsSync(pid_path) && readFileSync(pid_path, 'utf8').trim() === String(process.pid)
}

// The directory goes first, so no launcher reaches this daemon again; the requests already written are
// still read for a moment and replied `stale`, so their launchers run themselves without waiting out.
// A directory a successor has claimed since is left to it.
function close(daemon: Daemon): void {
	daemon.is_closing = true
	clearTimeout(daemon.idle)
	if (is_own_directory(daemon.directory)) rmSync(daemon.directory, { recursive: true, force: true })
	setTimeout(() => {
		daemon.lines.close()
		daemon.input.destroy()
	}, CLOSE_GRACE_MS)
}

function arm_idle(daemon: Daemon): void {
	clearTimeout(daemon.idle)
	daemon.idle = setTimeout(() => {
		close(daemon)
	}, daemon.idle_ms)
}

function is_refused_stale(daemon: Daemon, request: string): boolean {
	if (!daemon.is_closing && daemon.is_current()) return false

	reply(request, STALE_REPLY)
	if (!daemon.is_closing) close(daemon)

	return true
}

function write_answer(request: string, answer: CallAnswer): void {
	writeFileSync(path.join(request, 'out'), answer.stdout)
	writeFileSync(path.join(request, 'err'), answer.stderr)
	reply(request, String(answer.status))
}

async function serve_call(daemon: Daemon, request: string): Promise<void> {
	if (is_refused_stale(daemon, request)) return

	const raw_payload = readFileSync(path.join(request, 'payload'), 'utf8')
	const launch_directory = readFileSync(path.join(request, 'cwd'), 'utf8')
	const launcher_pid = Number(readFileSync(path.join(request, LAUNCHER_NAME), 'utf8'))

	write_answer(request, await daemon.answer(raw_payload, launch_directory, launcher_pid))
	arm_idle(daemon)
}

// One call at a time, in arrival order: the next request line is read only once this call is answered.
async function serve(daemon: Daemon): Promise<void> {
	arm_idle(daemon)

	for await (const request of daemon.lines) {
		try {
			await serve_call(daemon, request)
		} catch (error) {
			error_text.trace_swallowed('hook_daemon.serve_call', error)
		}
	}
}

// Built aside and renamed into place, so a launcher never sees a directory without its `pid`, and only
// one of several daemons started at once claims it.
function claim(directory: string): boolean {
	const staging = `${directory}.${String(process.pid)}`

	mkdirSync(staging, { recursive: true })
	execFileSync('mkfifo', [path.join(staging, REQUESTS_NAME)])
	writeFileSync(path.join(staging, PID_NAME), `${String(process.pid)}\n`)

	try {
		renameSync(staging, directory)

		return true
	} catch {
		rmSync(staging, { recursive: true, force: true })

		return false
	}
}

// Opened read-write, so the FIFO never reads end-of-file between launchers, and non-blocking, so it is
// read on the event loop rather than holding a thread.
function daemon_of(directory: string, options: DaemonOptions): Daemon {
	const descriptor = openSync(path.join(directory, REQUESTS_NAME), REQUESTS_FLAGS)
	const input = new Socket({ fd: descriptor, readable: true, writable: false })

	return {
		directory,
		answer: options.answer ?? own_answer(),
		is_current: options.is_current ?? bundle_currency(OUT_DIR, PACKAGE_DIR),
		idle_ms: options.idle_ms ?? IDLE_MINUTES * MINUTE_MS,
		input,
		lines: createInterface({ input }),
		idle: undefined,
		is_closing: false,
	}
}

function start(directory: string, options: DaemonOptions = {}): Daemon | undefined {
	return claim(directory) ? daemon_of(directory, options) : undefined
}

// Out of the hook's process group and streams, so the hook call that started it ends without it.
function detach(directory: string): void {
	spawn(process.execPath, [...process.execArgv, DAEMON_SCRIPT, directory], {
		detached: true,
		stdio: 'ignore',
	}).unref()
}

async function main(launch_arguments: ReadonlyArray<string>): Promise<void> {
	const [first = '', second = ''] = launch_arguments

	if (first === DETACH_FLAG) {
		detach(second)

		return
	}

	const daemon = start(first)

	if (daemon !== undefined) await serve(daemon)
}

// Resolved, as `import.meta.url` is: an installed package is launched through its `node_modules`
// symlink (joshuafolkken/kit#6962).
function is_launched(launched: string | undefined): boolean {
	return launched !== undefined && existsSync(launched) && realpathSync(launched) === DAEMON_SCRIPT
}

if (is_launched(process.argv[1])) await main(process.argv.slice(ARGUMENTS_START))

const hook_daemon = { bundle_currency, close, serve, start, STALE_REPLY }

export type { Daemon, DaemonOptions }
export { hook_daemon }
