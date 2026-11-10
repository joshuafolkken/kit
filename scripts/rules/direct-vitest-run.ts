import { command_memory, type ToolCall } from '#scripts/gate/command-memory'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The `direct-vitest-run` row of `delivered-rules.ts` (joshuafolkken/kit#7144). `pnpm josh test:related`
// takes the files as arguments and hands every flag on to vitest, and it leaves the record the gate
// reuses; a hand-typed `vitest run` leaves none, so the gate runs the same tests again.
//
// **Only the runs `test:related` can carry**: `vitest run` or bare `vitest`, launched directly,
// through `pnpm` / `npx` / `pnpm exec` or inside `sh -c` (`command_memory.tool_calls_of`, the reading
// `lane-direct-tool` shares). Silent: a run pinned to one project or config (`--project`,
// `--config`, `-c`), whose spaced value `test:related` would read as a file; another subcommand (`bench`, `list`); `--help` / `--version`;
// and a run inside `reserved-run`, the budgeted path a lane child is rewritten to.
//
// **It fires on every occurrence**: a run refused once and free after would leave the record unwritten
// on every later run.

const VITEST_PROGRAM = 'vitest'
// The subcommands other than `run`; a first word not named here is `run`'s file filter.
const OTHER_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'bench',
	'list',
	'init',
	'typecheck',
	'related',
	'watch',
	'dev',
])
const EXEMPT_FLAGS: ReadonlySet<string> = new Set([
	'--project',
	'--config',
	'-c',
	'--help',
	'-h',
	'--version',
	'-v',
])
const FLAG_VALUE_SEPARATOR = '='

function is_exempt_flag(argument: string): boolean {
	return EXEMPT_FLAGS.has(argument.split(FLAG_VALUE_SEPARATOR, 1)[0] ?? argument)
}

function is_carried_arguments(args: ReadonlyArray<string>): boolean {
	if (OTHER_SUBCOMMANDS.has(args[0] ?? '')) return false

	return args.every((argument) => !is_exempt_flag(argument))
}

function is_carried_run(call: ToolCall): boolean {
	if (call.name !== VITEST_PROGRAM || call.is_reserved) return false

	return is_carried_arguments(call.args)
}

function is_direct_vitest_run(command: string): boolean {
	return command_memory.tool_calls_of(command).some((call) => is_carried_run(call))
}

const TEST_RELATED: ReadonlySet<string> = new Set(['test:related'])

function is_test_related(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, TEST_RELATED))
}

function is_any_test_run(command: string): boolean {
	return is_direct_vitest_run(command) || is_test_related(command)
}

const DIRECT_VITEST_RUN_REASON =
	'⛔ direct vitest run: pnpm josh test:related [<file>…]\n' +
	'Run that in place of this `vitest run` — it hands the files and `--flag=value` flags on to ' +
	'vitest and leaves ' +
	'the record the gate reuses (`docs/josh-commands.md` → "`josh test:related`"). `--project` / ' +
	'`--config` and `vitest bench` / `list` pass. **This rule fires on every occurrence.**'

const ROW = {
	id: 'direct-vitest-run',
	is_trigger: bash_triggers.on_bash_command(is_direct_vitest_run),
	reason: DIRECT_VITEST_RUN_REASON,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(is_test_related),
	reaches: bash_triggers.on_bash_command(is_any_test_run),
	about: {
		title: 'Direct vitest run',
		topic: '`docs/josh-commands.md` → "`josh test:related`"',
		fires:
			'`vitest run` or bare `vitest` (directly, through `pnpm` / `npx` / `pnpm exec`, or inside `sh -c`); it points at `pnpm josh test:related`. Every occurrence',
		quiet:
			'`pnpm josh test:related`, `--project` / `--config` / `-c`, another subcommand (`bench`, `list`, …), `--help` / `--version`, or a run inside `pnpm josh reserved-run`',
	},
}

const direct_vitest_run = { DIRECT_VITEST_RUN_REASON, ROW, is_direct_vitest_run }

export { direct_vitest_run }
