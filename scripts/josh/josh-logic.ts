import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin, resolve_package_bin } from '#scripts/build/local-bin'
import { package_version_schema } from '#scripts/lib/schemas'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { execaSync } from 'execa'
import { command_suggest } from './command-suggest'
import {
	ALIASES,
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from './josh-command-map'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh-composite-arguments'
import { josh_in_process } from './josh-in-process'
import { kit_only } from './kit-only'

const COLUMN_WIDTH = 26
const ALIAS_PAD_WIDTH = 2
const TSX_BIN = 'tsx'
const TSX_PACKAGE = 'tsx'
const PACKAGE_JSON = 'package.json'
// Not an exit code the shell ever sees: `josh.ts` reads it as "no such command" and answers with
// the listing on stderr. It is named because `run_command` now reports through a promise, where a
// bare `-1` is one step further from the check that reads it.
const UNKNOWN_COMMAND_EXIT_CODE = -1

interface TsxRunner {
	executable: string
	leading_arguments: ReadonlyArray<string>
}

// Resolve the kit package root by ascending to the nearest package.json. This works both
// from the bundled dist/josh.js (one level under the root) and from the tsx source at
// scripts/josh/ (two levels), so this file's depth no longer has to be hard-coded.
function find_package_directory(start_directory: string): string {
	let current = start_directory

	while (!existsSync(path.join(current, PACKAGE_JSON))) {
		const parent = path.dirname(current)
		if (parent === current) return start_directory
		current = parent
	}

	return current
}

const PACKAGE_DIR = find_package_directory(path.dirname(fileURLToPath(import.meta.url)))

function resolve_tsx_executable(): string {
	const candidates = [
		resolve_local_bin(PACKAGE_DIR, TSX_BIN),
		resolve_local_bin(process.cwd(), TSX_BIN),
	]

	return candidates.find(existsSync) ?? TSX_BIN
}

// Locating the CLI entry through tsx's own manifest never consults pnpm's generated shim, which
// hardcodes a store path a later bump prunes. The resolution itself is `resolve_package_bin` —
// shared with the format hook's eslint route rather than written twice (joshuafolkken/kit#1259).
function resolve_tsx_cli_entry(): string | undefined {
	for (const base_directory of [PACKAGE_DIR, process.cwd()]) {
		const cli_entry = resolve_package_bin(base_directory, TSX_PACKAGE, TSX_BIN)
		if (cli_entry !== undefined) return cli_entry
	}

	return undefined
}

// Preferred: run the resolved CLI entry with the current node binary. The `.bin` shim lookup
// stays as a fallback for layouts where tsx is not resolvable from either manifest.
function resolve_tsx_runner(): TsxRunner {
	const cli_entry = resolve_tsx_cli_entry()

	if (cli_entry !== undefined) {
		return { executable: process.execPath, leading_arguments: [cli_entry] }
	}

	return { executable: resolve_tsx_executable(), leading_arguments: [] }
}

function read_package_version(): string {
	const raw = readFileSync(path.join(PACKAGE_DIR, PACKAGE_JSON), 'utf8')

	return package_version_schema.parse(JSON.parse(raw)).version
}

const HEADER = `josh v${read_package_version()} — Joshua Folkken's dev toolkit`
const USAGE = 'Usage: josh <command> [options]'
const ALL_HINT = "Run 'josh --all' to also list kit-maintenance commands."

// The help splits by audience: `josh --help` shows the commands a kit user runs day to day, and
// `josh --all` adds the kit-maintenance ones below (joshuafolkken/kit#1928). These are the
// maintenance set — publishing, propagating and reconciling kit itself, plus the git-hook internals
// that lefthook invokes rather than a person. Membership lives here, one reviewable list, rather than
// as a flag threaded through every command entry.
const MAINTENANCE_COMMANDS: ReadonlySet<string> = new Set([
	'release',
	'release:scope',
	'propagate',
	'reconcile-templates',
	'audit:provision',
	'eval',
	'secretlint-scan',
	'prevent-main-commit',
	'check-commit-message',
	'pre-push-unit',
	'pre-commit-type-check',
])

function build_alias_lookup(): Map<string, string> {
	const lookup = new Map<string, string>()
	for (const [alias, cmd] of Object.entries(ALIASES)) lookup.set(cmd, alias)

	return lookup
}

function resolve_alias(cmd: string): string {
	return Object.hasOwn(ALIASES, cmd) ? (ALIASES[cmd] ?? cmd) : cmd
}

function format_command_line(cmd: string, entry: CommandEntry, alias?: string): string {
	const prefix = alias ? `${alias}, `.padEnd(ALIAS_PAD_WIDTH + ALIAS_PAD_WIDTH) : ''

	return `  ${(prefix + cmd).padEnd(COLUMN_WIDTH)}${entry.description}`
}

function format_category_section(
	category: CommandCategory,
	entries: Array<[string, CommandEntry]>,
	alias_lookup: Map<string, string>,
): string {
	const lines = entries.map(([cmd, entry]) =>
		format_command_line(cmd, entry, alias_lookup.get(cmd)),
	)

	return [`${category}:`, ...lines].join('\n')
}

// A consumer never sees a kit-only command; inside kit the maintenance split (`--help` vs `--all`) is
// all that hides anything (joshuafolkken/kit#1988).
function is_visible_command(
	cmd: string,
	entry: CommandEntry,
	is_all: boolean,
	is_consumer: boolean,
): boolean {
	if (is_consumer && kit_only.is_kit_only(entry)) return false

	return is_all || !MAINTENANCE_COMMANDS.has(cmd)
}

function collect_visible(
	is_all: boolean,
	is_consumer: boolean,
): Map<CommandCategory, Array<[string, CommandEntry]>> {
	const by_category = new Map<CommandCategory, Array<[string, CommandEntry]>>(
		CATEGORY_ORDER.map((cat) => [cat, []]),
	)

	for (const [cmd, entry] of Object.entries(COMMAND_MAP)) {
		if (is_visible_command(cmd, entry, is_all, is_consumer)) {
			by_category.get(entry.category)?.push([cmd, entry])
		}
	}

	return by_category
}

// `josh --help` lists the day-to-day commands; `josh --all` adds the kit-maintenance ones. A category
// left empty once the maintenance commands are filtered out is dropped rather than printed as a bare
// heading (joshuafolkken/kit#1928).
function format_help(is_all = false, is_consumer = false): string {
	const by_category = collect_visible(is_all, is_consumer)
	const alias_lookup = build_alias_lookup()
	const sections = CATEGORY_ORDER.map((cat) => [cat, by_category.get(cat) ?? []] as const)
		.filter(([, entries]) => entries.length > 0)
		.map(([cat, entries]) => format_category_section(cat, entries, alias_lookup))
	const footer = is_all ? USAGE : `${USAGE}\n${ALL_HINT}`

	return [HEADER, '', sections.join('\n\n'), '', footer].join('\n')
}

// Every name a user could type — the canonical commands and their aliases — ranked by edit distance
// so `josh gat` points at `gate` (joshuafolkken/kit#1928).
function all_command_names(): Array<string> {
	return [...Object.keys(COMMAND_MAP), ...Object.keys(ALIASES)]
}

// `josh <unknown>` answers on stderr with a short line rather than the whole listing. A shell
// substituting `$(josh port dev)` captures stdout alone, so a name this kit cannot resolve — a typo,
// a retired command — must leave that stream empty rather than dump the toolkit index there, how #825
// surfaced. It used to print the full help here; #1928 cut that to one line plus a "did you mean"
// when a close command exists, so the diagnosis is readable and the stdout contract is unchanged.
// `josh` and `josh --help` still print the listing to stdout, because there it is the answer rather
// than the diagnosis.
function format_unknown_command(cmd: string): string {
	const suggestion = command_suggest.closest_command(cmd, all_command_names())
	const hint = suggestion === undefined ? '' : ` Did you mean '${suggestion}'?`

	return `Unknown command: ${cmd}.${hint} Run 'josh --help' to list commands.`
}

// A `.cmd` shim needs the win32 shell to be executable, but the node binary does not — and
// running it through the shell would break on the spaces in a typical Windows install path.
function should_use_shell(executable: string): boolean {
	return process.platform === 'win32' && executable !== process.execPath
}

function spawn_script(tsx_executable: string, script_arguments: Array<string>): number {
	const result = execaSync(tsx_executable, script_arguments, {
		stdio: 'inherit',
		shell: should_use_shell(tsx_executable),
		reject: false,
	})

	return resolve_spawn_exit(tsx_executable, result)
}

function run_shell_command(shell: ReadonlyArray<string>, extra: Array<string>): number {
	const [executable = '', ...rest_arguments] = shell
	const result = execaSync(executable, [...rest_arguments, ...extra], {
		stdio: 'inherit',
		reject: false,
	})

	return resolve_spawn_exit(executable, result)
}

function spawn_script_entry(
	entry: CommandEntry,
	script_path: string,
	script_arguments: ReadonlyArray<string>,
): number {
	const runner = resolve_tsx_runner()

	return spawn_script(runner.executable, [
		...runner.leading_arguments,
		...(entry.tsx_arguments ?? []),
		script_path,
		...script_arguments,
	])
}

// Only the in-process branch is genuinely asynchronous; the spawning one answers the moment the
// child exits. Both are reported as a promise so every caller has one shape to handle, and
// `josh.ts` awaits it either way (joshuafolkken/kit#1342).
async function run_script_entry(
	entry: CommandEntry,
	subcommand_arguments: Array<string>,
): Promise<number> {
	const script_path = path.join(PACKAGE_DIR, entry.script ?? '')
	const script_arguments = [...(entry.default_script_arguments ?? []), ...subcommand_arguments]

	if (josh_in_process.can_run_in_process(entry, import.meta.url)) {
		return await josh_in_process.run_in_process(script_path, script_arguments)
	}

	return spawn_script_entry(entry, script_path, script_arguments)
}

// The exit a command answers with before it runs, or `undefined` to go ahead: a consumer is refused a
// kit-only command with guidance, and a composite command rejects extra arguments
// (joshuafolkken/kit#1988).
function pre_dispatch_exit(
	resolved: string,
	entry: CommandEntry,
	subcommand_arguments: Array<string>,
	is_consumer: boolean,
): number | undefined {
	if (is_consumer && kit_only.is_kit_only(entry)) {
		console.error(kit_only.notice(resolved))

		return USAGE_ERROR_EXIT_CODE
	}

	const rejection = composite_arguments.reject_extra_arguments(
		resolved,
		entry,
		subcommand_arguments,
	)
	if (rejection === undefined) return undefined
	console.error(rejection)

	return USAGE_ERROR_EXIT_CODE
}

async function dispatch_entry(
	entry: CommandEntry,
	subcommand_arguments: Array<string>,
): Promise<number> {
	if (entry.shell) return run_shell_command(entry.shell, subcommand_arguments)

	return await run_script_entry(entry, subcommand_arguments)
}

async function run_command(
	cmd: string,
	subcommand_arguments: Array<string>,
	is_consumer = false,
): Promise<number> {
	const resolved = resolve_alias(cmd)
	const entry = Object.hasOwn(COMMAND_MAP, resolved) ? COMMAND_MAP[resolved] : undefined

	if (!entry) return UNKNOWN_COMMAND_EXIT_CODE

	const early_exit = pre_dispatch_exit(resolved, entry, subcommand_arguments, is_consumer)
	if (early_exit !== undefined) return early_exit

	return await dispatch_entry(entry, subcommand_arguments)
}

const josh_logic = {
	format_help,
	format_unknown_command,
	run_command,
	spawn_script,
	run_shell_command,
}

export type { CommandEntry } from './josh-command-map'
export { ALIASES, COMMAND_MAP } from './josh-command-map'
export type { TsxRunner }
export { SPAWN_ERROR_EXIT_CODE } from '#scripts/lib/spawn-exit'
export { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh-composite-arguments'
export {
	find_package_directory,
	josh_logic,
	resolve_alias,
	resolve_tsx_executable,
	resolve_tsx_runner,
	UNKNOWN_COMMAND_EXIT_CODE,
}
