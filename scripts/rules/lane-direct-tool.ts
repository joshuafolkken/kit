import { command_memory } from '#scripts/gate/command-memory'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { bash_triggers } from './bash-triggers'

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
// TypeScript program per worker, so `--concurrency 4` or `auto` held 12 GB in one lane and swapped the
// machine. `--concurrency off`, `1` and no flag pass.
//
// **Lane children only.** An interactive session outside a lane keeps its direct runs; the overlap this
// prevents is between concurrently dispatched lanes.

const HEAVY_TOOLS: ReadonlySet<string> = new Set(['eslint', 'vitest', 'cspell', 'tsc'])

// True when any command on the shell line launches one of the heavy tools outside a `reserved-run`.
// The cut is quote-aware, so a tool name inside a quoted argument (`git commit -m "run eslint"`) is
// never read as a command; a quoted script handed to a shell is.
function runs_heavy_tool(command: string): boolean {
	return command_memory
		.tool_calls_of(command)
		.some((call) => !call.is_reserved && HEAVY_TOOLS.has(call.name))
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
	'`--concurrency off`; measure concurrency outside a lane. Refused on every occurrence.'

// The row itself, so `delivered-rules.ts` spreads one entry; the shape is `lane-switch-main.ts`'s.
const ROW = {
	id: 'lane-direct-tool',
	is_trigger: bash_triggers.on_bash_command(is_lane_direct_tool),
	reason: LANE_DIRECT_TOOL_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Lane child running a heavy tool directly',
		topic: '`docs/josh-commands-automation.md` → `josh reserved-run`',
		fires:
			'a dispatched lane child launching `eslint` / `vitest` / `cspell` / `tsc` (bare, `pnpm exec`, `npx`, inside `sh -c`), or eslint with `--concurrency` other than `off` / `1` by any path, `reserved-run` included. Every occurrence',
		quiet: 'not a lane child, or the run goes through `pnpm josh` with single-worker eslint',
	},
}

const lane_direct_tool = {
	LANE_DIRECT_TOOL_REASON,
	ROW,
	is_lane_direct_tool,
	runs_heavy_tool,
}

export { lane_direct_tool }
