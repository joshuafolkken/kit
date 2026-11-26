import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { process_identity } from '#scripts/josh/process-identity'
import { lane_process_table, type ProcessTable } from '#scripts/lane/lane-process-table'
import { poll } from '#scripts/lib/poll'
import { run_ship_wait_cli } from './ship/run-ship-wait-cli'

// `josh wait` — one foreground wait for a started child, which nothing re-invokes after its turn
// (joshuafolkken/kit#8336). A bare `sleep` between reads cost one model request per read, each
// re-reading the whole cached context; this wait ends when its target does, or at the `ship:wait`
// chunk below the prompt-cache TTL, so a long wait costs one request per chunk.
//
// - `--pid <pid>` — done once the process is gone.
// - `--process <pattern>` — done once no process but this wait's own lineage and other `josh wait`s
//   matches, as `pgrep -f`; a wait left over from an earlier call carries the pattern too.
// - `--file <path>` — done once the file exists.
// - `--result <dir>` — a check `bounded-check.ts` left running: done once its exit code is written,
//   and then its log and exit code are this wait's own (joshuafolkken/kit#8708).
// - no target — a backgrounded subagent, whose end reaches the session only after this call: the chunk.
//
// Past `--result`, the result is the target's own output; the wait only says when to read it.

const VERDICT = { DONE: 'done', PENDING: 'pending' } as const

type Verdict = (typeof VERDICT)[keyof typeof VERDICT]
// Whether the target has finished.
type Probe = () => Promise<boolean> | boolean

interface WaitOptions {
	chunk_ms: number
	sleeper: (duration_ms: number) => Promise<void>
}

const POLL_MS = 2000
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
// A bounded check still running: non-zero so a shell `&&` stops on it, and apart from a red check's
// code — the BSD exit status for "temporary failure, try again later".
const PENDING_EXIT_CODE = 75
// An exit code as the detached child writes it; anything else reads as a failure, never as green.
const EXIT_CODE_TEXT = /^\d+$/u
const USAGE =
	'Usage: josh wait [--pid <pid> | --process <pattern> | --file <path> | --result <dir>]'
const ARGUMENT_OPTIONS = {
	pid: { type: 'string' },
	process: { type: 'string' },
	file: { type: 'string' },
	result: { type: 'string' },
} as const
// A bounded check's result directory: the detached launch's log and pid, and the exit code its child
// writes.
const RESULT_FILES = { log: 'check.log', exit: 'exit-code', pid: 'pid' } as const
// The line `detached_launch` stamps at the head of a log, which the check itself never printed.
const LOG_HEADER = /^\n=== .* ===\n/u

// The no-target wait: nothing this process can read ends it before the chunk.
function never(): boolean {
	return false
}

// This process and every ancestor: the shell and `pnpm` that started it carry the pattern too.
function lineage(rows: ProcessTable, pid: number): Set<number> {
	const parent_of = new Map(rows.map((row) => [row.pid, row.parent]))
	const seen = new Set<number>()

	for (let current = parent_of.has(pid) ? pid : undefined; current !== undefined;) {
		seen.add(current)
		const parent = parent_of.get(current)

		current = parent === undefined || seen.has(parent) ? undefined : parent
	}

	return seen
}

// Another `josh wait` (or the shell that launched it) carries the waited-for pattern in its own
// command line, so a wait left over from an earlier call would hold this one pending.
// The node line reads `…/josh-ready.ts wait --process <pattern>`, the shell's carries the same words.
const OTHER_WAIT = /\bwait --(?:pid|process|file|result)\b/u

// No match outside this wait's lineage and other waits; an unanswered `ps` reads as still running.
function is_gone_in(rows: ProcessTable | undefined, pattern: string): boolean {
	if (rows === undefined) return false
	const own = lineage(rows, process.pid)
	const waits = new Set(rows.filter((row) => OTHER_WAIT.test(row.command)).map((row) => row.pid))

	return lane_process_table
		.probes_of(rows)
		.matching(pattern)
		.every((pid) => own.has(pid) || waits.has(pid))
}

function pid_probe(value: string): Probe | undefined {
	const pid = Number(value)

	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined

	return () => !process_identity.is_present_pid(pid)
}

// The pattern is compiled here so one that does not read as an expression is refused as usage.
function process_probe(pattern: string): Probe {
	const { source } = new RegExp(pattern, 'u')

	return async () => is_gone_in(await lane_process_table.read_table(), source)
}

// The probe the arguments name, `undefined` for arguments that do not read as one target or none.
function probe_of(argv: ReadonlyArray<string>): Probe | undefined {
	const { values } = parseArgs({ args: [...argv], options: ARGUMENT_OPTIONS, strict: true })
	const { pid, process: pattern, file, result } = values
	const named = [pid, pattern, file, result].filter((value) => value !== undefined)

	if (named.length > 1) return undefined
	if (pid !== undefined) return pid_probe(pid)
	if (pattern !== undefined) return process_probe(pattern)

	return file === undefined ? never : () => existsSync(file)
}

async function wait_for(is_done: Probe, options: WaitOptions): Promise<Verdict> {
	const deadline = Date.now() + options.chunk_ms

	return await poll.wait_for(
		async () => {
			if (await is_done()) return VERDICT.DONE

			return Date.now() >= deadline ? VERDICT.PENDING : undefined
		},
		{ interval_ms: POLL_MS, sleeper: options.sleeper },
	)
}

function result_path(directory: string, file: keyof typeof RESULT_FILES): string {
	return path.join(directory, RESULT_FILES[file])
}

// A check killed by a signal never emits `exit`, so its launch being gone also ends the wait.
function is_launch_gone(directory: string): boolean {
	const pid_path = result_path(directory, 'pid')

	if (!existsSync(pid_path)) return false
	const probe = pid_probe(readFileSync(pid_path, 'utf8'))

	return probe !== undefined && probe() === true
}

function is_finished(directory: string): boolean {
	return existsSync(result_path(directory, 'exit')) || is_launch_gone(directory)
}

// The exit code the check wrote; a missing or malformed one reads as a failure, never as green.
function exit_code_of(directory: string): number {
	const exit_path = result_path(directory, 'exit')
	const text = existsSync(exit_path) ? readFileSync(exit_path, 'utf8') : ''

	if (EXIT_CODE_TEXT.test(text)) return Number(text)
	console.error('wait: the check ended without writing its exit code — killed by a signal?')

	return FAILURE_EXIT_CODE
}

// The finished check's own output and exit code, as its synchronous run would have left them.
function replay(directory: string): number {
	const log = readFileSync(result_path(directory, 'log'), 'utf8')

	process.stdout.write(log.replace(LOG_HEADER, ''))

	return exit_code_of(directory)
}

// One chunk of a bounded check: its result once it finishes inside, else `pending` and the next wait.
async function collect(directory: string, options: WaitOptions): Promise<number> {
	const verdict = await wait_for(() => is_finished(directory), options)

	if (verdict === VERDICT.DONE) return replay(directory)
	console.info(
		`pending — the check is still running in the background: run \`pnpm josh wait --result ${directory}\` for its output and exit code`,
	)

	return PENDING_EXIT_CODE
}

function result_of(argv: ReadonlyArray<string>): string | undefined {
	try {
		return parseArgs({ args: [...argv], options: ARGUMENT_OPTIONS, strict: true }).values.result
	} catch {
		return undefined
	}
}

// The chunk counts from the process start, as `ship:wait`'s does (`run_ship_wait_cli.chunk_left`).
function live_chunk(): WaitOptions {
	return { chunk_ms: run_ship_wait_cli.chunk_left(), sleeper: sleep }
}

const NEXT_ACTION: Record<Verdict, string> = {
	[VERDICT.DONE]: "read the target's own output",
	[VERDICT.PENDING]: 'still running: run the same `pnpm josh wait` again',
}

function read_probe(argv: ReadonlyArray<string>): Probe | undefined {
	try {
		return probe_of(argv)
	} catch {
		return undefined
	}
}

// A directory no bounded check launched into would answer `pending` on every call, so it is refused.
async function collect_result(directory: string): Promise<number> {
	if (existsSync(result_path(directory, 'log'))) return await collect(directory, live_chunk())
	console.error(`wait: no bounded check result in ${directory}`)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const probe = read_probe(argv)

	if (probe === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = result_of(argv)

	if (result !== undefined) return await collect_result(result)
	const verdict = await wait_for(probe, live_chunk())

	console.info(`wait: ${verdict} — ${NEXT_ACTION[verdict]}`)

	return SUCCESS_EXIT_CODE
}

const run_wait_cli = {
	CHUNK_MS: run_ship_wait_cli.CHUNK_MS,
	PENDING_EXIT_CODE,
	VERDICT,
	collect,
	live_chunk,
	result_path,
	is_gone_in,
	lineage,
	probe_of,
	run,
	wait_for,
}

export type { WaitOptions }
export { run_wait_cli }
