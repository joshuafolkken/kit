import { hook_context } from '#scripts/hooks/hook-context'
import { pretool_guard } from '#scripts/hooks/pretool-guard'
import { durable_state_root } from '#scripts/josh/durable-state-root'
import { hook_decision } from '#scripts/josh/hook-decision'
import { hook_payload_capture } from '#scripts/josh/hook-payload-capture'
import { platform_temporary } from '#scripts/josh/platform-temporary'
import { lane_reap } from '#scripts/lane/lane-reap'

// One `pretool-guard` call answered inside the resident hook daemon (`hook-daemon.ts`,
// joshuafolkken/kit#6683) exactly as a fresh `node dist/hooks/pretool-guard.js` would answer it: the
// process environment is put to the call's own, as its launcher (`run-hook.sh`) wrote it, with the
// call's launch directory (`JOSH_HOOK_CWD`), so one daemon serves every caller of its checkout
// (joshuafolkken/kit#7125); the working directory to the root it was started in; and the call's process
// ancestry walked from its launcher, so a carry record the calling session owns is told apart as a
// fresh guard tells it.
// Then the steps `hook_decision.respond_from_stdin` takes after reading stdin run in the same order,
// and what the hook writes is collected rather than reaching the daemon's own streams. The guard sets no
// exit code, so a call answers 0 unless it throws, which a fresh process ends with 1.
// The temporary roots are read once at import (`platform-temporary.ts`, `durable-state-root.ts`), so
// they stay the daemon's own: a call whose `JOSH_TEMP_ROOT` differs is not answerable here.

const COMMAND = 'pretool:guard'
const LAUNCH_DIRECTORY_VARIABLE = 'JOSH_HOOK_CWD'
const THROWN_EXIT = 1
const ASSIGNMENT = '='
// The launcher writes one `name=value` line per variable, with `%` and line breaks in a value escaped.
const ESCAPE_PATTERN = /%(?:25|0A)/gu
const ESCAPED_PERCENT = '%25'

interface DaemonCall {
	readonly raw_payload: string
	readonly launch_directory: string
	readonly launcher_pid: number
	readonly environment: Readonly<Record<string, string>>
}

interface CallAnswer {
	readonly status: number
	readonly stdout: string
	readonly stderr: string
}

type Stream = NodeJS.WriteStream

function unescaped(value: string): string {
	return value.replaceAll(ESCAPE_PATTERN, (escape) => (escape === ESCAPED_PERCENT ? '%' : '\n'))
}

function parse_environment(text: string): Record<string, string> {
	return Object.fromEntries(
		text
			.split('\n')
			.map((line) => [line, line.indexOf(ASSIGNMENT)] as const)
			.filter(([, separator]) => separator > 0)
			.map(([line, separator]) => [line.slice(0, separator), unescaped(line.slice(separator + 1))]),
	)
}

function is_answerable(call: DaemonCall): boolean {
	const { TEMP_ROOT_KEY } = platform_temporary

	return call.environment[TEMP_ROOT_KEY] === durable_state_root.STATE_ROOT_OVERRIDE
}

function restore_process(root: string, call: DaemonCall): void {
	for (const key of Object.keys(process.env)) {
		if (!Object.hasOwn(call.environment, key)) Reflect.deleteProperty(process.env, key)
	}

	Object.assign(process.env, call.environment, {
		[LAUNCH_DIRECTORY_VARIABLE]: call.launch_directory,
	})
	process.chdir(root)
}

function collect(stream: Stream, chunks: Array<string>): () => void {
	const { write } = stream

	stream.write = function write_collected(chunk: string | Uint8Array): boolean {
		chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))

		return true
	}

	return function release(): void {
		stream.write = write
	}
}

async function status_of(run: () => Promise<void>, stderr: Array<string>): Promise<number> {
	try {
		await run()

		return 0
	} catch (error) {
		stderr.push(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)

		return THROWN_EXIT
	}
}

// The context is the process's, as a fresh guard builds it, but for the ancestry: walked from the
// launcher, the fresh guard's parent, rather than from this detached daemon.
async function respond(raw_payload: string, launcher_pid: number): Promise<void> {
	hook_decision.load_environment_file()
	hook_payload_capture.capture(COMMAND, raw_payload)
	await pretool_guard.respond(raw_payload, {
		...hook_context.from_process(),
		ancestry: () => lane_reap.ancestry_of(launcher_pid),
	})
}

async function answer(root: string, call: DaemonCall): Promise<CallAnswer> {
	const stdout: Array<string> = []
	const stderr: Array<string> = []
	const releases = [collect(process.stdout, stdout), collect(process.stderr, stderr)]

	restore_process(root, call)
	const status = await status_of(async () => {
		await respond(call.raw_payload, call.launcher_pid)
	}, stderr)

	for (const release of releases) release()

	return { status, stdout: stdout.join(''), stderr: stderr.join('') }
}

const hook_daemon_call = { answer, is_answerable, parse_environment, LAUNCH_DIRECTORY_VARIABLE }

export type { CallAnswer, DaemonCall }
export { hook_daemon_call }
