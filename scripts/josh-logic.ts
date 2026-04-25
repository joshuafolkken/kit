import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	ALIASES,
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from './josh-command-map'
import { package_version_schema, package_with_deps_schema } from './schemas'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const COLUMN_WIDTH = 26
const ALIAS_PAD_WIDTH = 2
const TSX_BIN = 'tsx'
const TSX_CMD = 'tsx.cmd'
const SVELTE_KIT_DEP = '@sveltejs/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const SPAWN_ERROR_EXIT_CODE = 2

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

function spawn_script(tsx_executable: string, script_arguments: Array<string>): number {
	const result = spawnSync(tsx_executable, script_arguments, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	})

	if (result.error) {
		console.error(`Failed to execute ${tsx_executable}: ${result.error.message}`)

		return SPAWN_ERROR_EXIT_CODE
	}

	return result.status ?? 1
}

function run_shell_command(shell: ReadonlyArray<string>, extra: Array<string>): number {
	const [executable = '', ...rest_arguments] = shell
	const result = spawnSync(executable, [...rest_arguments, ...extra], { stdio: 'inherit' })

	if (result.error) {
		console.error(`Failed to execute ${executable}: ${result.error.message}`)

		return SPAWN_ERROR_EXIT_CODE
	}

	return result.status ?? 1
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
