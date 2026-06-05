import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { package_version_schema, package_with_deps_schema } from '#scripts/schemas'
import { execaSync } from 'execa'
import {
	ALIASES,
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from './josh-command-map'

const COLUMN_WIDTH = 26
const ALIAS_PAD_WIDTH = 2
const TSX_BIN = 'tsx'
const TSX_CMD = 'tsx.cmd'
const SVELTE_KIT_DEP = '@sveltejs/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const SPAWN_ERROR_EXIT_CODE = 2

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
	const bin_name = process.platform === 'win32' ? TSX_CMD : TSX_BIN
	const candidates = [
		path.join(PACKAGE_DIR, NODE_MODULES, '.bin', bin_name),
		path.join(process.cwd(), NODE_MODULES, '.bin', bin_name),
	]

	return candidates.find(existsSync) ?? TSX_BIN
}

function read_package_version(): string {
	return package_version_schema.parse(
		JSON.parse(readFileSync(path.join(PACKAGE_DIR, PACKAGE_JSON), 'utf8')),
	).version
}

function is_sveltekit_project(): boolean {
	try {
		const parsed = package_with_deps_schema.parse(
			JSON.parse(readFileSync(path.join(process.cwd(), PACKAGE_JSON), 'utf8')),
		)
		const all_deps = { ...parsed.dependencies, ...parsed.devDependencies }

		return SVELTE_KIT_DEP in all_deps
	} catch {
		return false
	}
}

const HEADER = `josh v${read_package_version()} — Joshua Folkken's dev toolkit`
const USAGE = 'Usage: josh <command> [options]'

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

function format_help(): string {
	const by_category = new Map<CommandCategory, Array<[string, CommandEntry]>>(
		CATEGORY_ORDER.map((cat) => [cat, []]),
	)

	for (const [cmd, entry] of Object.entries(COMMAND_MAP)) {
		by_category.get(entry.category)?.push([cmd, entry])
	}

	const alias_lookup = build_alias_lookup()
	const sections = CATEGORY_ORDER.map((cat) =>
		format_category_section(cat, by_category.get(cat) ?? [], alias_lookup),
	)

	return [HEADER, '', sections.join('\n\n'), '', USAGE].join('\n')
}

// A numeric exit code — zero or not — means the command ran; return it verbatim.
// `exitCode: undefined` means it never produced one: either a true spawn failure
// (the replacement for spawnSync's `result.error`) or a signal kill. Only the
// former is reported as a spawn error; a signal kill falls back to 1, matching the
// previous `result.status ?? 1`.
function resolve_spawn_exit(
	executable: string,
	result: {
		exitCode?: number | undefined
		isTerminated?: boolean
		shortMessage?: string | undefined
	},
): number {
	if (result.exitCode !== undefined) return result.exitCode
	if (result.isTerminated === true) return 1

	console.error(`Failed to execute ${executable}: ${result.shortMessage ?? 'spawn failed'}`)

	return SPAWN_ERROR_EXIT_CODE
}

function spawn_script(tsx_executable: string, script_arguments: Array<string>): number {
	const result = execaSync(tsx_executable, script_arguments, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
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

function is_sveltekit_guard_failed(cmd: string, entry: CommandEntry): boolean {
	if (!entry.requires_sveltekit) return false
	if (is_sveltekit_project()) return false

	console.error(
		`josh ${cmd}: requires a SvelteKit project (@sveltejs/kit not found in dependencies)`,
	)

	return true
}

function run_script_entry(entry: CommandEntry, subcommand_arguments: Array<string>): number {
	const tsx_executable = resolve_tsx_executable()
	const script_arguments = [
		...(entry.tsx_arguments ?? []),
		path.join(PACKAGE_DIR, entry.script ?? ''),
		...(entry.default_script_arguments ?? []),
		...subcommand_arguments,
	]

	return spawn_script(tsx_executable, script_arguments)
}

function run_command(cmd: string, subcommand_arguments: Array<string>): number {
	const resolved = resolve_alias(cmd)
	const entry = Object.hasOwn(COMMAND_MAP, resolved) ? COMMAND_MAP[resolved] : undefined

	if (!entry) return -1
	if (is_sveltekit_guard_failed(resolved, entry)) return 1
	if (entry.shell) return run_shell_command(entry.shell, subcommand_arguments)

	return run_script_entry(entry, subcommand_arguments)
}

const josh_logic = { format_help, run_command, spawn_script, run_shell_command }

export type { CommandEntry } from './josh-command-map'
export { ALIASES, COMMAND_MAP } from './josh-command-map'
export { josh_logic, resolve_alias, resolve_tsx_executable, SPAWN_ERROR_EXIT_CODE }
