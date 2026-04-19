import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from './josh-command-map'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const COLUMN_WIDTH = 24
const TSX_BIN = 'tsx'
const SVELTE_KIT_DEP = '@sveltejs/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'

function resolve_tsx_executable(): string {
	const candidates = [
		path.join(PACKAGE_DIR, NODE_MODULES, '.bin', TSX_BIN),
		path.join(process.cwd(), NODE_MODULES, '.bin', TSX_BIN),
	]

	return candidates.find(existsSync) ?? TSX_BIN
}

function read_package_version(): string {
	const parsed = JSON.parse(readFileSync(path.join(PACKAGE_DIR, PACKAGE_JSON), 'utf8')) as {
		version: string
	}

	return parsed.version
}

function is_sveltekit_project(): boolean {
	try {
		const parsed = JSON.parse(
			readFileSync(path.join(process.cwd(), PACKAGE_JSON), 'utf8'),
		) as Record<string, Record<string, string> | undefined>
		// eslint-disable-next-line dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature
		const all_deps = { ...parsed['dependencies'], ...parsed['devDependencies'] }

		return SVELTE_KIT_DEP in all_deps
	} catch {
		return false
	}
}

const HEADER = `josh v${read_package_version()} — Joshua Folkken's dev toolkit`
const USAGE = 'Usage: josh <command> [options]'

function format_command_line(cmd: string, entry: CommandEntry): string {
	return `  ${cmd.padEnd(COLUMN_WIDTH)}${entry.description}`
}

function format_category_section(
	category: CommandCategory,
	entries: Array<[string, CommandEntry]>,
): string {
	const lines = entries.map(([cmd, entry]) => format_command_line(cmd, entry))

	return [`${category}:`, ...lines].join('\n')
}

function format_help(): string {
	const by_category = new Map<CommandCategory, Array<[string, CommandEntry]>>(
		CATEGORY_ORDER.map((cat) => [cat, []]),
	)

	for (const [cmd, entry] of Object.entries(COMMAND_MAP)) {
		by_category.get(entry.category)?.push([cmd, entry])
	}

	const sections = CATEGORY_ORDER.map((cat) =>
		format_category_section(cat, by_category.get(cat) ?? []),
	)

	return [HEADER, '', sections.join('\n\n'), '', USAGE].join('\n')
}

function spawn_script(tsx_executable: string, script_arguments: Array<string>): number {
	const result = spawnSync(tsx_executable, script_arguments, { stdio: 'inherit' })

	if (result.error) console.error(`Failed to execute ${tsx_executable}: ${result.error.message}`)

	return result.status ?? 1
}

function run_shell_command(shell: ReadonlyArray<string>, extra: Array<string>): number {
	const [executable = '', ...rest_arguments] = shell
	const result = spawnSync(executable, [...rest_arguments, ...extra], { stdio: 'inherit' })

	if (result.error) console.error(`Failed to execute ${executable}: ${result.error.message}`)

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
	const entry = Object.hasOwn(COMMAND_MAP, cmd) ? COMMAND_MAP[cmd] : undefined

	if (!entry) return -1
	if (is_sveltekit_guard_failed(cmd, entry)) return 1
	if (entry.shell) return run_shell_command(entry.shell, subcommand_arguments)

	return run_script_entry(entry, subcommand_arguments)
}

const josh_logic = { format_help, run_command }

export type { CommandEntry } from './josh-command-map'
export { COMMAND_MAP } from './josh-command-map'
export { josh_logic, resolve_tsx_executable }
