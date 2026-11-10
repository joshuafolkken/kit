import { hook_context } from '#scripts/hooks/hook-context'
import { pretool_guard } from '#scripts/hooks/pretool-guard'
import { hook_decision } from '#scripts/josh/hook-decision'
import { hook_payload_capture } from '#scripts/josh/hook-payload-capture'
import { lane_reap } from '#scripts/lane/lane-reap'

// One `pretool-guard` call answered inside the resident hook daemon (`hook-daemon.ts`,
// joshuafolkken/kit#6683) exactly as a fresh `node dist/hooks/pretool-guard.js` would answer it: the
// process environment is put back to the one the daemon was started under, with only the call's own
// launch directory (`JOSH_HOOK_CWD`) changed, the working directory to the root it was started in, and
// the call's process ancestry walked from its launcher (`run-hook.sh`), so a carry record the calling
// session owns is told apart as a fresh guard tells it.
// Then the steps `hook_decision.respond_from_stdin` takes after reading stdin run in the same order,
// and what the hook writes is collected rather than reaching the daemon's own streams. The guard sets no
// exit code, so a call answers 0 unless it throws, which a fresh process ends with 1.

const COMMAND = 'pretool:guard'
const LAUNCH_DIRECTORY_VARIABLE = 'JOSH_HOOK_CWD'
const THROWN_EXIT = 1

interface DaemonOrigin {
	readonly root: string
	readonly environment: Readonly<Record<string, string | undefined>>
}

interface CallAnswer {
	readonly status: number
	readonly stdout: string
	readonly stderr: string
}

type Stream = NodeJS.WriteStream

function restore_process(origin: DaemonOrigin, launch_directory: string): void {
	for (const key of Object.keys(process.env)) {
		if (!Object.hasOwn(origin.environment, key)) Reflect.deleteProperty(process.env, key)
	}

	Object.assign(process.env, origin.environment, { [LAUNCH_DIRECTORY_VARIABLE]: launch_directory })
	process.chdir(origin.root)
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

async function answer(
	origin: DaemonOrigin,
	raw_payload: string,
	launch_directory: string,
	launcher_pid: number,
): Promise<CallAnswer> {
	const stdout: Array<string> = []
	const stderr: Array<string> = []
	const releases = [collect(process.stdout, stdout), collect(process.stderr, stderr)]

	restore_process(origin, launch_directory)
	const status = await status_of(async () => {
		await respond(raw_payload, launcher_pid)
	}, stderr)

	for (const release of releases) release()

	return { status, stdout: stdout.join(''), stderr: stderr.join('') }
}

const hook_daemon_call = { answer, LAUNCH_DIRECTORY_VARIABLE }

export type { CallAnswer, DaemonOrigin }
export { hook_daemon_call }
