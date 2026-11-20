import { existsSync } from 'node:fs'
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
// - `--process <pattern>` — done once no process but this wait's own lineage matches, as `pgrep -f`.
// - `--file <path>` — done once the file exists.
// - no target — a backgrounded subagent, whose end reaches the session only after this call: the chunk.
//
// The result is the target's own output; the wait only says when to read it.

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
const USAGE = 'Usage: josh wait [--pid <pid> | --process <pattern> | --file <path>]'
const ARGUMENT_OPTIONS = {
	pid: { type: 'string' },
	process: { type: 'string' },
	file: { type: 'string' },
} as const

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

// No match outside this wait's lineage; an unanswered `ps` reads as still running.
function is_gone_in(rows: ProcessTable | undefined, pattern: string): boolean {
	if (rows === undefined) return false
	const own = lineage(rows, process.pid)

	return lane_process_table
		.probes_of(rows)
		.matching(pattern)
		.every((pid) => own.has(pid))
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
	const { pid, process: pattern, file } = values
	const named = [pid, pattern, file].filter((value) => value !== undefined)

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

// The chunk counts from the process start, as `ship:wait`'s does: both clocks it is sized against
// start at the session's call.
function chunk_left(): number {
	return run_ship_wait_cli.CHUNK_MS - performance.now()
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

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const probe = read_probe(argv)

	if (probe === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const verdict = await wait_for(probe, { chunk_ms: chunk_left(), sleeper: sleep })

	console.info(`wait: ${verdict} — ${NEXT_ACTION[verdict]}`)

	return SUCCESS_EXIT_CODE
}

const run_wait_cli = {
	CHUNK_MS: run_ship_wait_cli.CHUNK_MS,
	VERDICT,
	is_gone_in,
	lineage,
	probe_of,
	run,
	wait_for,
}

export { run_wait_cli }
