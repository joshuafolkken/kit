import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// A dispatched lane child is stopped from running a heavy tool directly. The core budget
// (`scripts/gate/core-budget.ts`) counts only what a `josh` command reserves, so an `eslint`, `vitest`,
// `cspell` or `tsc` a lane agent launches itself is neither refused nor counted: it overlaps the other
// lanes' gates and shows up only as unexplained load to whatever is admitted next.
//
// **Every spelling collapses to the tool's name.** `git_argv.program_of` skips the wrapper words
// (`pnpm`, `npx`, `exec`, env assignments), so `pnpm exec eslint`, `npx vitest`, `pnpm tsc` and a bare
// `cspell` are all read as the program they launch. A `pnpm josh …` reads as `josh` and passes — that
// is the budgeted path, `pnpm josh reserved-run <weight> -- <command>` included.
//
// **Lane children only.** An interactive session outside a lane keeps its direct runs; the overlap this
// prevents is between concurrently dispatched lanes.

const HEAVY_TOOLS: ReadonlySet<string> = new Set(['eslint', 'vitest', 'cspell', 'tsc'])

// True when any command on the shell line launches one of the heavy tools. The cut is quote-aware, so a
// tool name inside a quoted argument (`git commit -m "run eslint"`) is never read as a command.
function runs_heavy_tool(command: string): boolean {
	return shell_segments
		.quote_aware_commands_of(command)
		.some((segment) => HEAVY_TOOLS.has(git_argv.program_of(segment)?.name ?? ''))
}

// True when this session is a dispatched lane child launching a heavy tool directly.
function is_lane_direct_tool(
	command: string,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	return is_lane_child && runs_heavy_tool(command)
}

const LANE_DIRECT_TOOL_REASON =
	'⛔ lane child running `eslint` / `vitest` / `cspell` / `tsc` directly: the core budget does not ' +
	'count it, so it overlaps the other lanes. Run `pnpm josh lint:related`, `pnpm josh test:related` or ' +
	'`pnpm josh cspell:dot`, or wrap it: `pnpm josh reserved-run <weight> -- <command>`. Refused on ' +
	'every occurrence (`docs/josh-commands-automation.md`).'

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
			'a dispatched lane child launching `eslint` / `vitest` / `cspell` / `tsc` (bare, `pnpm exec`, `npx`). Every occurrence',
		quiet: 'not a lane child, or the run goes through `pnpm josh`',
	},
}

const lane_direct_tool = {
	LANE_DIRECT_TOOL_REASON,
	ROW,
	is_lane_direct_tool,
	runs_heavy_tool,
}

export { lane_direct_tool }
