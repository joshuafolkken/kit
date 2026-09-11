import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run_wake_session, type LaunchResult } from './run-wake-session'

// joshuafolkken/kit#1719. What the supervisor spawns is the one place it could widen what may be run,
// so the argument vector is pinned rather than left to reading.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const REORDERED_INVOCATION = 'backlogrun --idle 30 --max 5'
const NO_WATCH_INVOCATION = 'backlogrun --idle 0'
const ONE_FLAG_INVOCATION = 'backlogrun --max 5'
const BARE_INVOCATION = 'backlogrun'
const SCRIPT = '/somewhere/run-wake-cli.ts'
const SKIP_PERMISSIONS = 'dangerously-skip-permissions'

describe('run_wake_session.wake_argv — what the woken session is asked to do', () => {
	it('runs the agent CLI headless with the recorded invocation as its prompt', () => {
		expect(run_wake_session.wake_argv(INVOCATION)).toStrictEqual({
			command: run_wake_session.WAKE_COMMAND,
			args: ['-p', INVOCATION],
		})
	})

	// The person typed the invocation; nothing between the record and the session may add to it.
	it('appends the invocation as one argument, never split on its spaces', () => {
		const argv = run_wake_session.wake_argv(INVOCATION)

		expect(argv?.args.at(-1)).toBe(INVOCATION)
		expect(argv?.args).toHaveLength(2)
	})

	// `auto-ok` decides what may be run unattended and is a person's to apply. A waker that could
	// write it would be widening its own authorization, so nothing it spawns may mention it.
	it('never names auto-ok anywhere in what it launches', () => {
		expect(JSON.stringify(run_wake_session.wake_argv(INVOCATION))).not.toContain('auto-ok')
	})

	// `eval-session.ts` passes it because that suite runs in a throwaway checkout whose credentials
	// were taken away. This one runs in the person's own repository, so it must not.
	it('does not disarm permission checks', () => {
		const argv = JSON.stringify(run_wake_session.wake_argv(INVOCATION))

		expect(argv).not.toContain(SKIP_PERMISSIONS)
	})

	// The binary was an environment variable first, which put the choice of what runs unattended with
	// the person's credentials in reach of anything that can set an environment. `eval-session.ts`
	// hard-codes the same binary for the same reason.
	it('takes the agent CLI from a constant rather than from the environment', () => {
		expect(run_wake_session.WAKE_COMMAND).toBe('claude')
		expect(JSON.stringify(run_wake_session)).not.toContain('JOSH_WAKE_COMMAND')
	})
})

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

	// The supervisor exists to continue a `backlogrun` and nothing else, so anything else in the record
	// is a record that has been tampered with or a bug — never something to launch a session with.
	it('refuses an invocation that is not a backlogrun', () => {
		expect(run_wake_session.wake_argv('epicrun #1716')).toBeUndefined()
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

function prompt_of(invocation: string): string | undefined {
	return run_wake_session.wake_argv(invocation)?.args.at(-1)
}

// The recorded invocation is taken apart and composed again out of this file's own constants and the
// integers that passed, so the text held in the record never reaches the operating system. A check
// that only inspected the string would leave it flowing into `spawn` unchanged.
describe('run_wake_session.wake_argv — the invocation is rebuilt, not passed through', () => {
	it('accepts a bare backlogrun and rebuilds it as the command word alone', () => {
		expect(prompt_of(BARE_INVOCATION)).toBe(BARE_INVOCATION)
	})

	it('accepts the budget flags and keeps the order they were recorded in', () => {
		expect(prompt_of(INVOCATION)).toBe(INVOCATION)
		expect(prompt_of(REORDERED_INVOCATION)).toBe(REORDERED_INVOCATION)
	})

	// `--idle 0` turns the idle watch off (joshuafolkken/kit#1676), so zero is a budget a person can
	// declare rather than a value that only ever meant "unset". A rebuild that refused it would wake
	// the next session watching for 30 minutes a run that asked to finish at its first empty backlog.
	it('carries an idle watch turned off across the cut', () => {
		expect(prompt_of(NO_WATCH_INVOCATION)).toBe(NO_WATCH_INVOCATION)
	})

	// A check that merely validated the value would accept this: `05` passes the integer test. The
	// rebuild writes it back as `5`, and a rebuilt string that differs from the record is refused —
	// the woken session hands its prompt straight to `run:carry --begin`, which compares it to the
	// record character for character, so continuing on a rewritten one cannot work.
	it('refuses a value the rebuild would have rewritten, which a bare check would accept', () => {
		expect(run_wake_session.wake_argv('backlogrun --max 05')).toBeUndefined()
	})

	it('refuses spacing the rebuild would have collapsed', () => {
		expect(run_wake_session.wake_argv('backlogrun   --max   5')).toBeUndefined()
	})

	// Dropping it would wake a session running to a budget the person never declared, the first time
	// `backlogrun` grows a flag this supervisor has not caught up with.
	it('refuses an unknown flag rather than dropping it', () => {
		expect(run_wake_session.wake_argv('backlogrun --lanes 3')).toBeUndefined()
		expect(run_wake_session.wake_argv(`${ONE_FLAG_INVOCATION} --lanes 3`)).toBeUndefined()
	})

	it('refuses a flag given without a value', () => {
		expect(run_wake_session.wake_argv('backlogrun --max')).toBeUndefined()
	})

	// `Number('')`, `Number(' ')` and `Number('0x10')` are all safe integers, so a check that only asked
	// `Number.isSafeInteger` would read an unset shell variable as a budget of zero.
	it('refuses a value that is not a plain non-negative integer', () => {
		expect(run_wake_session.wake_argv('backlogrun --max 5.5')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max -1')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max 0x10')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max many')).toBeUndefined()
	})

	// A command word this one is merely a prefix of is a different command, and starts nothing here.
	it('refuses a first token that is not the command this supervisor continues', () => {
		expect(run_wake_session.wake_argv('backlogrun-now --max 5')).toBeUndefined()
		expect(run_wake_session.wake_argv('--max 5')).toBeUndefined()
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

describe('the parent-session environment is single-sourced', () => {
	// Two copies of this list is the clone that fails silently: the child dials the parent's private
	// socket and the session dies with nothing naming the cause (joshuafolkken/kit#1158).
	it('removes each parent-session variable rather than blanking it', () => {
		const removed = agent_session_environment.removed_environment()

		expect(Object.keys(removed)).toStrictEqual([...agent_session_environment.PARENT_SESSION_KEYS])
		expect(JSON.stringify(removed)).toBe('{}')
	})

	it('names the messaging socket and token, which are the two that kill a child session', () => {
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_SOCKET')
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_TOKEN')
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
