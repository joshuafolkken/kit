import os from 'node:os'
import { bash_triggers } from '#scripts/rules/bash-triggers'
import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { core_weights } from './core-weights'

// The heavy tools a shell line launches, and the memory they hold (joshuafolkken/kit#4582).
//
// **`reserved-run` counted a wrapped command's cores and no memory**: a lane ran
// `reserved-run 4 -- sh -c '… eslint . --concurrency 4 …'`, typed eslint held a TypeScript program per
// worker, and the 12 GB process was admitted beside four other lanes until the machine swapped. The
// estimate here is what the wrapper now reserves, and the same reading is what `lane-direct-tool`
// refuses a multi-worker eslint on.
//
// **Every spelling is read down to the program.** `git_argv.program_of` skips the wrapper words, a
// quoted script handed to a shell is read as its own line (`bash_triggers.shell_script_of`), and the
// command after `pnpm josh reserved-run <weight> --` is read as the call it wraps, marked reserved. A
// heredoc body is text, not commands, so it is dropped before the line is cut.
//
// **The estimate is the largest tool's, not the sum**: the commands of one line run one after another,
// so only one of them is resident at a time. A line with no known tool is `undefined`, the 0 MB it
// counted before — `reserved-run 1 -- pnpm josh audit` reserves its own, and is not counted twice.

interface ToolCall extends ProgramCall {
	// Inside a `pnpm josh reserved-run … --`, the budgeted path.
	is_reserved: boolean
}

// A line still to be cut into its programs.
interface PendingLine {
	line: string
	is_reserved: boolean
}

const JOSH_PROGRAM = 'josh'
const RESERVED_RUN = 'reserved-run'
const COMMAND_SEPARATOR = '--'
const ESLINT = 'eslint'
const VITEST = 'vitest'
const AUTO_WORKERS = 'auto'
// ESLint 10's `auto` caps its workers at half the available cores (`eslint/lib/eslint/eslint.js`).
const AUTO_CORE_SHARE = 2
const SINGLE_WORKER = 1
// The flag each multi-worker tool takes its worker count from.
const WORKER_FLAGS: Readonly<Partial<Record<string, string>>> = {
	[ESLINT]: '--concurrency',
	[VITEST]: '--maxWorkers',
}

// The command `pnpm josh reserved-run <weight> [--memory <MB>] -- <command>` wraps, or `undefined`.
function wrapped_command_of(call: ProgramCall): string | undefined {
	if (call.name !== JOSH_PROGRAM || call.args[0] !== RESERVED_RUN) return undefined

	const separator = call.args.indexOf(COMMAND_SEPARATOR)

	return separator === -1 ? undefined : call.args.slice(separator + 1).join(' ')
}

// One command of a line: the program it launches, or the line it hands on — a `reserved-run`'s
// wrapped command, or a shell's quoted script.
function reading_of(segment: string, is_reserved: boolean): ToolCall | PendingLine | undefined {
	const call = git_argv.program_of(segment)
	const wrapped = call === undefined ? undefined : wrapped_command_of(call)

	if (wrapped !== undefined) return { line: wrapped, is_reserved: true }

	const script = bash_triggers.shell_script_of(segment)

	if (script !== undefined) return { line: script, is_reserved }

	return call === undefined ? undefined : { ...call, is_reserved }
}

function is_tool_call(reading: ToolCall | PendingLine): reading is ToolCall {
	return 'name' in reading
}

function is_pending_line(reading: ToolCall | PendingLine): reading is PendingLine {
	return !is_tool_call(reading)
}

// Every program the line launches, a shell's quoted script and a `reserved-run`'s command included.
// A queue rather than recursion: each handed-on line is shorter than the one it came from.
function tool_calls_of(line: string): Array<ToolCall> {
	const pending: Array<PendingLine> = [{ line, is_reserved: false }]
	const calls: Array<ToolCall> = []

	for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
		const { is_reserved } = next
		const readings = shell_segments
			.quote_aware_commands_of(time_shell.without_heredoc_bodies(next.line))
			.flatMap((segment) => reading_of(segment, is_reserved) ?? [])

		calls.push(...readings.filter((reading) => is_tool_call(reading)))
		pending.push(...readings.filter((reading) => is_pending_line(reading)))
	}

	return calls
}

// `--flag <value>` or `--flag=<value>`.
function flag_value(args: ReadonlyArray<string>, flag: string): string | undefined {
	const prefix = `${flag}=`
	const index = args.findIndex((argument) => argument === flag || argument.startsWith(prefix))
	const argument = args[index]

	if (argument === undefined) return undefined

	return argument === flag ? args[index + 1] : argument.slice(prefix.length)
}

// The workers a tool opens when its flag is missing. **vitest's default is the machine less one**
// (`maxWorkers`, run mode): `vitest.config.ts` shares the machine only between marked runs, so a lone
// direct run opens them all. ESLint's `--concurrency` defaults to `off`, one worker.
function default_workers(name: string, cores: number): number {
	return name === VITEST ? Math.max(SINGLE_WORKER, cores - 1) : SINGLE_WORKER
}

// A worker flag's count: half the cores for `auto`, else the number — one for `off` and an unreadable
// value alike.
function count_of(value: string, cores: number): number {
	if (value === AUTO_WORKERS) return Math.max(SINGLE_WORKER, Math.floor(cores / AUTO_CORE_SHARE))

	const count = Number(value)

	return Number.isSafeInteger(count) && count > SINGLE_WORKER ? count : SINGLE_WORKER
}

function workers_of(call: ToolCall, cores: number = os.availableParallelism()): number {
	const flag = WORKER_FLAGS[call.name]
	const value = flag === undefined ? undefined : flag_value(call.args, flag)

	return value === undefined ? default_workers(call.name, cores) : count_of(value, cores)
}

function memory_of(call: ToolCall, cores: number): number | undefined {
	const row = core_weights.TOOL_MEMORY[call.name]

	return row === undefined ? undefined : core_weights.MEMORY_MB[row] * workers_of(call, cores)
}

// The MB the line's largest tool holds, or `undefined` when it launches none the table knows.
function estimated_memory_mb(
	line: string,
	cores: number = os.availableParallelism(),
): number | undefined {
	const amounts = tool_calls_of(line).flatMap((call) => memory_of(call, cores) ?? [])

	return amounts.length === 0 ? undefined : Math.max(...amounts)
}

// True when the line runs eslint with more than one worker, wrapped or not.
function runs_multi_worker_eslint(
	line: string,
	cores: number = os.availableParallelism(),
): boolean {
	return tool_calls_of(line).some(
		(call) => call.name === ESLINT && workers_of(call, cores) > SINGLE_WORKER,
	)
}

const command_memory = { estimated_memory_mb, runs_multi_worker_eslint, tool_calls_of }

export { command_memory }
export type { ToolCall }
