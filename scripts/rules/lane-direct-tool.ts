import os from 'node:os'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { command_memory, type ToolCall } from '#scripts/gate/command-memory'
import { core_weights } from '#scripts/gate/core-weights'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { timed_rerun } from './timed-rerun'

// A dispatched lane child is stopped from running a heavy tool directly. The core budget
// (`scripts/gate/core-budget.ts`) counts only what a `josh` command reserves, so an `eslint`, `vitest`,
// `cspell` or `tsc` a lane agent launches itself is neither refused nor counted: it overlaps the other
// lanes' gates and shows up only as unexplained load to whatever is admitted next.
//
// **Every spelling collapses to the tool's name.** `command_memory.tool_calls_of` skips the wrapper
// words (`pnpm`, `npx`, `exec`, env assignments) and reads a shell's quoted script (`sh -c '…'`,
// `bash -c "…"`, `eval`) as the commands it runs, so `pnpm exec eslint`, `npx vitest`, `pnpm tsc`, a
// bare `cspell` and any of them inside `sh -c` are all read as the program they launch. A
// `pnpm josh …` reads as `josh` and passes — that is the budgeted path, and the command
// `pnpm josh reserved-run <weight> -- <command>` wraps is read as reserved.
//
// **A multi-worker eslint is refused even when reserved** (joshuafolkken/kit#4582): typed eslint holds a
// TypeScript program per worker, so `--concurrency 4` or `auto` in one lane swapped the machine. `--concurrency off`, `1` and no flag pass.
//
// **Lane children only.** An interactive session outside a lane keeps its direct runs; the overlap this
// prevents is between concurrently dispatched lanes.
//
// **The commonest direct run is rewritten rather than refused** (joshuafolkken/kit#5147): the refusal's
// reissue was the same line behind `pnpm josh reserved-run <weight> --`, a round trip the hook can make
// itself. The weight is the gate's own for that tool — `core_weights.CORE_WEIGHTS`, and for vitest the
// workers `command_memory.workers_of` reads — so the claim matches what the gate claims. `reserved-run`
// runs its command as an argv, not a shell line, so only a line that is one command is wrapped: any
// chain, pipe, redirection, group, substitution, comment, env prefix or timer leaves it to the refusal,
// as does a multi-worker eslint, which no reservation makes safe. The wrapped line runs in the directory
// it was typed in (`reserved-run.ts` → `command_directory`).

const ESLINT = 'eslint'
const VITEST = 'vitest'
const HEAVY_TOOLS: ReadonlySet<string> = new Set([ESLINT, VITEST, 'cspell', 'tsc'])
const TOOL_WEIGHTS: Readonly<Partial<Record<string, number>>> = {
	[ESLINT]: core_weights.CORE_WEIGHTS.lint,
	tsc: core_weights.CORE_WEIGHTS.type_check,
	cspell: core_weights.CORE_WEIGHTS.spell_check,
}
const SINGLE_CORE = 1
const RESERVED_RUN = 'pnpm josh reserved-run'
// Read on the quote-blanked line: a quoted `;` or `|` is text. `2>&1` applies to the wrapper alike.
const MULTI_COMMAND_SYNTAX = /[;|&<>()`#\n]|\$\(/u
const KEPT_REDIRECT = /2>&1/gu
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/u

const RESERVED_NOTE =
	'↻ lane direct tool: a lane child ran a heavy tool directly, so the line was wrapped in ' +
	'`pnpm josh reserved-run <weight> --` to claim its cores beside the other lanes. Prefer ' +
	'`pnpm josh lint:related` / `test:related` / `cspell:dot` — `docs/josh-commands-automation.md`.'

// The heavy tools the line launches outside a `reserved-run`. The cut is quote-aware, so a tool name
// inside a quoted argument (`git commit -m "run eslint"`) is never read as a command; a quoted script
// handed to a shell is.
function direct_calls(command: string): Array<ToolCall> {
	return command_memory
		.tool_calls_of(command)
		.filter((call) => !call.is_reserved && HEAVY_TOOLS.has(call.name))
}

// True when any command on the shell line launches one of the heavy tools outside a `reserved-run`.
function runs_heavy_tool(command: string): boolean {
	return direct_calls(command).length > 0
}

function weight_of(call: ToolCall, cores: number): number {
	if (call.name === VITEST) return command_memory.workers_of(call, cores)

	return TOOL_WEIGHTS[call.name] ?? SINGLE_CORE
}

// True when the whole line is one command, so a `reserved-run` can carry it as its argv.
function is_one_command(command: string): boolean {
	const judged = time_shell.blanked(command)

	if (judged === undefined) return false

	return (
		!MULTI_COMMAND_SYNTAX.test(judged.replaceAll(KEPT_REDIRECT, ' ')) &&
		!ENV_ASSIGNMENT.test(judged)
	)
}

// A timed line stays as typed: `timed-rerun` reads the timer at the segment start, and a wrapper in front
// would hide it from that row.
function can_wrap(line: string, cores: number): boolean {
	if (!is_one_command(line) || timed_rerun.is_timed_run(line)) return false

	return !command_memory.runs_multi_worker_eslint(line, cores)
}

// The line behind `reserved-run` at its largest tool's weight, or `undefined` where it must be refused.
function reserved_command(
	command: string,
	cores: number = os.availableParallelism(),
): string | undefined {
	const line = command.trim()
	const calls = direct_calls(line)

	if (!can_wrap(line, cores) || calls.length === 0) return undefined

	const weight = Math.max(...calls.map((call) => weight_of(call, cores)))

	return `${RESERVED_RUN} ${String(weight)} -- ${line}`
}

function is_lane_bash(call: GuardedCall): boolean {
	return call.name === cost_blocks.BASH_TOOL && lane_child_marker.is_child_of(process.cwd())
}

// The call's input with its line wrapped, for a lane child alone; `undefined` where nothing is rewritten.
function reserved_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (!is_lane_bash(call) || !json_value.is_record(call.input)) return undefined

	const command = reserved_command(time_shell.bash_command(call.input))

	return command === undefined ? undefined : { ...call.input, command }
}

// True when this session is a dispatched lane child launching a heavy tool directly, or eslint with
// more than one worker by any path.
function is_lane_direct_tool(
	command: string,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!is_lane_child) return false

	return runs_heavy_tool(command) || command_memory.runs_multi_worker_eslint(command)
}

const LANE_DIRECT_TOOL_REASON =
	'⛔ lane child running `eslint` / `vitest` / `cspell` / `tsc` directly, or multi-worker eslint: ' +
	'it overlaps the other lanes. Run `pnpm josh lint:related`, `pnpm josh test:related`, ' +
	'`pnpm josh cspell:dot` or `pnpm josh reserved-run <weight> -- <command>`, eslint at ' +
	'`--concurrency off`. Only a one-command line is wrapped for you. Refused on every occurrence.'

// The row itself, so `delivered-rules.ts` spreads one entry; the shape is `lane-switch-main.ts`'s.
const ROW = {
	id: 'lane-direct-tool',
	is_trigger: bash_triggers.on_bash_command(is_lane_direct_tool),
	reason: LANE_DIRECT_TOOL_REASON,
	decide: (): boolean => true,
	rewrite: reserved_input,
	rewrite_note: RESERVED_NOTE,
	about: {
		title: 'Lane child running a heavy tool directly',
		topic: '`docs/josh-commands-automation.md` → `josh reserved-run`',
		fires:
			"a dispatched lane child launching `eslint` / `vitest` / `cspell` / `tsc` (bare, `pnpm exec`, `npx`, inside `sh -c`), or eslint with `--concurrency` other than `off` / `1` by any path, `reserved-run` included. A one-command line is rewritten behind `pnpm josh reserved-run <weight> --` at the gate's weight; a chained, piped, redirected or env-prefixed line and a multi-worker eslint are refused, every occurrence",
		quiet: 'not a lane child, or the run goes through `pnpm josh` with single-worker eslint',
	},
}

const lane_direct_tool = {
	LANE_DIRECT_TOOL_REASON,
	RESERVED_NOTE,
	ROW,
	is_lane_direct_tool,
	reserved_command,
	reserved_input,
	runs_heavy_tool,
}

export { lane_direct_tool }
