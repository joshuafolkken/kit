import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run_wake_session, type LaunchResult } from './run-wake-session'

// joshuafolkken/kit#1719. What the supervisor spawns is the one place it could widen what may be run,
// so the argument vector is pinned rather than left to reading.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const SCRIPT = '/somewhere/run-wake-cli.ts'
const LOOPBACK_PROXY = 'http://localhost:52554'

// Nothing here is exploitable as the code stands — `spawn` is given an argument vector and never a
// shell — but "it cannot be exploited the way this is written today" is an argument rather than a
// check, and an edit that added `shell: true` would silently turn it into nothing.
describe('run_wake_session — what may reach the operating system', () => {
	// `execve` treats a NUL as the end of a string, so a value carrying one runs as a prefix of
	// itself — the argument that runs is not the argument that was checked.
	it('refuses an invocation carrying a NUL byte', () => {
		expect(run_wake_session.wake_argv(`${INVOCATION}\u{0}--rm`)).toBeUndefined()
	})

	it('refuses an invocation carrying any other control character', () => {
		expect(run_wake_session.wake_argv(`${INVOCATION}\nrm -rf /`)).toBeUndefined()
	})

	it('refuses an empty invocation', () => {
		expect(run_wake_session.wake_argv('')).toBeUndefined()
	})

	// The supervisor continues a `backlogrun` and nothing else, so anything else in the record is a
	// record that has been tampered with or a bug — never something to launch a session with. `epicrun`
	// and `fullrun` are the two whose cut still waits for a keyword; `queue` was removed entirely
	// (joshuafolkken/kit#1984).
	it('refuses an invocation that is neither', () => {
		expect(run_wake_session.wake_argv('epicrun #1716')).toBeUndefined()
		expect(run_wake_session.wake_argv('fullrun #1774')).toBeUndefined()
		expect(run_wake_session.wake_argv('rm -rf /')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun; rm -rf /')).toBeUndefined()
	})

	it('accepts a bare backlogrun and one carrying its budget flags', () => {
		expect(run_wake_session.wake_argv('backlogrun')).toBeDefined()
		expect(run_wake_session.wake_argv(INVOCATION)).toBeDefined()
	})

	// The gate sits at the call itself, so it holds for what this module builds as well.
	it('accepts the supervisor’s own argument vector', () => {
		expect(run_wake_session.is_safe_argv(run_wake_session.supervisor_argv(SCRIPT, '15'))).toBe(true)
	})

	it('refuses to launch an argument vector that does not pass', () => {
		const result = run_wake_session.launch(
			{ argv: { command: 'claude\u{0}', args: [] }, cwd: '.' },
			() => undefined,
		)

		expect(result.kind).toBe('failed')
	})
})
describe('run_wake_session.supervisor_argv — the detached self', () => {
	// Without the runner's own loader flags the detached process starts and fails on the syntax of the
	// TypeScript entry point, which would look exactly like a supervisor that never ran.
	it('carries the runner’s loader flags across to the detached process', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT)

		expect(argv.command).toBe(process.execPath)
		expect(argv.args.slice(0, process.execArgv.length)).toStrictEqual(process.execArgv)
	})

	it('runs the loop body and names the script it was given', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT)

		expect(argv.args.at(-1)).toBe(run_wake_session.LOOP_FLAG)
		expect(argv.args.at(-2)).toBe(SCRIPT)
	})

	// `--start --interval 15` accepts the flag, so a supervisor that then polled at the default would
	// be silently ignoring what it was told.
	it('forwards a chosen interval to the detached supervisor', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT, '15')

		expect(argv.args.slice(-2)).toStrictEqual([run_wake_session.INTERVAL_FLAG, '15'])
	})
})

// What `removed_environment` takes out is pinned beside the module itself, in
// `scripts/josh/agent-session-environment.test.ts`. What belongs here is that this launcher spreads
// it over the inherited environment at all — the half a reader of this file can check.
describe('the launched session does not inherit what the launcher must not pass on', () => {
	it('hands the spawn every key that module removes, set to undefined', () => {
		const removed = agent_session_environment.removed_environment({ HTTPS_PROXY: LOOPBACK_PROXY })

		expect(Object.keys(removed)).toContain('CLAUDE_CODE_MESSAGING_SOCKET')
		expect(Object.keys(removed)).toContain('HTTPS_PROXY')
		expect(JSON.stringify(removed)).toBe('{}')
	})
})

// joshuafolkken/kit#1746. A woken session that exits without claiming the carry record used to leave
// nothing at all behind, because `stdio: 'ignore'` rode along with `detached` — and the two are
// separate requirements. These pin the half that changed: the child is still detached, and its output
// now survives it.

const MARKER = 'wake-log-marker'
const POLL_LIMIT = 60
const POLL_INTERVAL_MS = 50

const log_scratch = { directory: '', target: '' }

beforeEach(() => {
	log_scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-log-test-'))
	log_scratch.target = path.join(log_scratch.directory, 'wake.log')
})

afterEach(() => {
	rmSync(log_scratch.directory, { force: true, recursive: true })
})

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
}

// The child is detached, so there is no exit event to await here; the file is polled instead, with a
// ceiling so a failure reports rather than hangs.
async function logged_text(): Promise<string> {
	for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
		const text = readFileSync(log_scratch.target, 'utf8')

		if (text.includes(MARKER)) return text

		await settle()
	}

	return readFileSync(log_scratch.target, 'utf8')
}

describe('run_wake_session.launch — the child’s output is kept', () => {
	it('writes what the child prints to the named log', async () => {
		const argv = {
			command: process.execPath,
			args: ['-e', `console.log(${JSON.stringify(MARKER)})`],
		}

		const result = run_wake_session.launch(
			{ argv, cwd: log_scratch.directory, log_path: log_scratch.target },
			() => undefined,
		)

		expect(result.kind).toBe('launched')
		expect(await logged_text()).toContain(MARKER)
	})

	it('keeps what the child writes to standard error too, which is where a failure says why', async () => {
		const argv = {
			command: process.execPath,
			args: ['-e', `console.error(${JSON.stringify(MARKER)})`],
		}

		run_wake_session.launch(
			{ argv, cwd: log_scratch.directory, log_path: log_scratch.target },
			() => undefined,
		)

		expect(await logged_text()).toContain(MARKER)
	})
})

// joshuafolkken/kit#1904: the caller hands the child a fact the inherited environment does not carry
// — a dispatched lane child's mark among them — so a launch that dropped the extra environment would
// leave the mark unset and the pre-gate cut unmade. The child echoes the variable back through the log
// the same way every other case here reads its result.
describe('run_wake_session.launch — extra environment reaches the child', () => {
	it('sets a variable the caller passed on the spawned child', async () => {
		const argv = {
			command: process.execPath,
			args: ['-e', 'console.log(process.env.JOSH_LAUNCH_TEST_KEY ?? "")'],
		}

		run_wake_session.launch(
			{
				argv,
				cwd: log_scratch.directory,
				log_path: log_scratch.target,
				env: { JOSH_LAUNCH_TEST_KEY: MARKER },
			},
			() => undefined,
		)

		expect(await logged_text()).toContain(MARKER)
	})
})

// joshuafolkken/kit#1759. The regression these pin is not a wrong path — the displayed one and the
// written one were always the same value — but a file whose existence depended on something having
// launched into it, which left `--list` naming a path that was never created.
describe('run_wake_session.ensure_log — the log exists before anything launches', () => {
	it('creates the named log where nothing has been launched', () => {
		run_wake_session.ensure_log(log_scratch.target, () => undefined)

		expect(existsSync(log_scratch.target)).toBe(true)
	})

	// "Created even where the session exited immediately (empty is fine)" is the acceptance criterion,
	// and an empty file is the honest answer: a header here would announce a session that never ran.
	it('leaves a log nothing has launched into empty', () => {
		run_wake_session.ensure_log(log_scratch.target, () => undefined)

		expect(readFileSync(log_scratch.target, 'utf8')).toBe('')
	})

	it('reports a log it could not create rather than failing silently', () => {
		const notes: Array<string> = []

		run_wake_session.ensure_log(path.join(log_scratch.directory, 'absent', 'wake.log'), (note) => {
			notes.push(note)
		})

		expect(notes.join('\n')).toContain('could not be opened')
	})

	// The file is opened for append, so the launch that follows adds to it rather than replacing it —
	// which is what lets a supervisor's whole run accumulate in one file.
	it('keeps what a later launch writes, appended rather than replacing it', async () => {
		run_wake_session.ensure_log(log_scratch.target, () => undefined)
		const argv = {
			command: process.execPath,
			args: ['-e', `console.log(${JSON.stringify(MARKER)})`],
		}

		run_wake_session.launch(
			{ argv, cwd: log_scratch.directory, log_path: log_scratch.target },
			() => undefined,
		)

		expect(await logged_text()).toContain(MARKER)
	})
})

describe('run_wake_session.launch — where no log is named', () => {
	// The log is an improvement on the diagnosis, never a precondition for starting a session: a caller
	// with nowhere to write gets exactly the behavior every launch had before.
	it('discards the output where no log is named', () => {
		const argv = { command: process.execPath, args: ['-e', '""'] }

		const result = run_wake_session.launch({ argv, cwd: log_scratch.directory }, () => undefined)

		expect(result.kind).toBe('launched')
		expect(existsSync(log_scratch.target)).toBe(false)
	})

	// The safety gate runs before anything is opened, so a refused vector leaves no file behind either.
	it('opens no log for an argument vector it refuses', () => {
		run_wake_session.launch(
			{ argv: { command: 'claude\u{0}', args: [] }, cwd: '.', log_path: log_scratch.target },
			() => undefined,
		)

		expect(existsSync(log_scratch.target)).toBe(false)
	})
})

// The path is the temp directory plus a digest of the repository, so on a shared `/tmp` anyone who
// knows the checkout can work it out and leave something at it first. These pin the two halves of the
// answer: the symlink is not followed, and the file has to be this account's own.
const PRINTS_MARKER = ['-e', `console.log(${JSON.stringify(MARKER)})`]

function launch_printing(log_path: string, on_error: (note: string) => void): LaunchResult {
	return run_wake_session.launch(
		{
			argv: { command: process.execPath, args: PRINTS_MARKER },
			cwd: log_scratch.directory,
			log_path,
		},
		on_error,
	)
}

function notes_of(log_path: string): Array<string> {
	const notes: Array<string> = []

	launch_printing(log_path, (note) => {
		notes.push(note)
	})

	return notes
}

// A directory that is not there, which is the ordinary shape of a log that cannot be opened.
function log_in_missing_directory(): string {
	return path.join(log_scratch.directory, 'no-such-directory', 'wake.log')
}

describe('run_wake_session.launch — the log path is not trusted', () => {
	it('refuses to append through a symlink, and says so', () => {
		const decoy = path.join(log_scratch.directory, 'decoy.txt')

		writeFileSync(decoy, '')
		symlinkSync(decoy, log_scratch.target)

		expect(notes_of(log_scratch.target).join('\n')).toContain(log_scratch.target)
		expect(readFileSync(decoy, 'utf8')).toBe('')
	})

	// A discarded diagnosis is a reason to say so, never a reason to leave the run asleep — `--list` and
	// every warning name this path whether or not it could be opened.
	it('reports a log it could not open rather than discarding the output in silence', () => {
		expect(notes_of(log_in_missing_directory()).join('\n')).toContain(log_in_missing_directory())
	})

	it('still starts the session when the log could not be opened', () => {
		expect(launch_printing(log_in_missing_directory(), () => undefined).kind).toBe('launched')
	})
})

// Three sessions were started for one lost cut in joshuafolkken/kit#1746, and they all append to one
// file — so the log has to say where each launch begins.
describe('run_wake_session.launch — each launch is delimited', () => {
	it('writes a header naming the time and the launching process', async () => {
		const argv = {
			command: process.execPath,
			args: ['-e', `console.log(${JSON.stringify(MARKER)})`],
		}

		run_wake_session.launch(
			{ argv, cwd: log_scratch.directory, log_path: log_scratch.target },
			() => undefined,
		)

		expect(await logged_text()).toContain(`started by process ${String(process.pid)}`)
	})
})
