import { find_local_bin_upwards } from '#scripts/local-bin'
import { execa } from 'execa'

// joshuafolkken/kit#934: `josh gate`'s type-check step used to be `tsc --noEmit` for every project.
// A SvelteKit project type-checks with `svelte-check` behind `svelte-kit sync`, so the fixed step
// both missed every `.svelte` type error and failed outright on a clean checkout, where `./$types`
// has not been generated yet.
//
// The step is therefore asked of the application layer rather than assumed. Two rules decide it:
//
// 1. **Only the project's own toolkit counts.** The shim is found by walking up from the working
//    directory to a `node_modules/.bin`, the same walk pnpm performs — never by running
//    `pnpm <bin>`, which falls through to a globally installed toolkit and would run a SvelteKit
//    type check on a project that is not one.
// 2. **The command exists only if the toolkit says so.** The resolved shim is run with no
//    subcommand and the usage line it prints is read, exactly as the `verify-ui` skill decides
//    whether a `shot` command exists. Presence of the toolkit is not presence of the command:
//    app-kit gained `check:ci` in one version and `shot` in another.

const DEFAULT_TYPE_CHECK_ARGS: ReadonlyArray<string> = ['josh', 'check']
// Ordered: `check:ci` is the strict variant a gate wants; `check` is the fast dev-loop one, taken
// only by a toolkit that has no strict variant.
const PREFERRED_COMMANDS: ReadonlyArray<string> = ['check:ci', 'check']
const TOOLKIT_BINS: ReadonlyArray<string> = ['josh-app', 'josh-game']
// `Usage: josh-app <init|sync|check|check:ci|…>` — the commands are the `|`-separated group that
// follows the literal `Usage:`. Anchoring on that word rather than on a line start matters twice
// over: the output is stdout and stderr merged, which execa joins without inserting a newline, and
// a bracketed warning printed first would otherwise be read as the command list.
const USAGE_COMMANDS_PATTERN = /Usage:[^<>\n]*<([^<>\n]+)>/u
const COMMAND_SEPARATOR = '|'
// A toolkit that prints its usage answers in milliseconds; anything slower is hung.
const USAGE_TIMEOUT_MS = 30_000

function parse_usage_commands(output: string): ReadonlyArray<string> {
	const group = USAGE_COMMANDS_PATTERN.exec(output)?.[1]
	if (group === undefined) return []

	return group.split(COMMAND_SEPARATOR).map((command) => command.trim())
}

// Run with no subcommand. A toolkit answers with its usage line whether that exits 0 or not, so the
// output is read rather than the status; a shim that cannot be spawned at all yields nothing. The
// spawn is async so the probe overlaps the gate's other three checks instead of delaying them.
async function read_toolkit_commands(bin_path: string): Promise<ReadonlyArray<string>> {
	try {
		const result = await execa(bin_path, [], {
			all: true,
			reject: false,
			timeout: USAGE_TIMEOUT_MS,
		})

		return parse_usage_commands(result.all)
	} catch {
		return []
	}
}

function find_preferred_command(commands: ReadonlyArray<string>): string | undefined {
	return PREFERRED_COMMANDS.find((preferred) => commands.includes(preferred))
}

async function resolve_toolkit_step(
	start_directory: string,
	bin_name: string,
): Promise<ReadonlyArray<string> | undefined> {
	const bin_path = find_local_bin_upwards(start_directory, bin_name)
	if (bin_path === undefined) return undefined

	const command = find_preferred_command(await read_toolkit_commands(bin_path))

	return command === undefined ? undefined : [bin_name, command]
}

// The command the gate spawns through `pnpm`, so a toolkit step resolves the same shim `pnpm` would.
async function resolve_type_check_args(start_directory: string): Promise<ReadonlyArray<string>> {
	for (const bin_name of TOOLKIT_BINS) {
		const step = await resolve_toolkit_step(start_directory, bin_name)
		if (step !== undefined) return step
	}

	return DEFAULT_TYPE_CHECK_ARGS
}

const type_check_step = {
	parse_usage_commands,
	resolve_toolkit_step,
	resolve_type_check_args,
}

export { DEFAULT_TYPE_CHECK_ARGS, type_check_step }
