import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/local-bin'
import { package_bin_schema, package_version_schema } from '#scripts/schemas'
import { resolve_spawn_exit } from '#scripts/spawn-exit'
import { execaSync } from 'execa'
import {
	ALIASES,
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from './josh-command-map'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh-composite-arguments'

const COLUMN_WIDTH = 26
const ALIAS_PAD_WIDTH = 2
const TSX_BIN = 'tsx'
const TSX_MANIFEST = 'tsx/package.json'
const PACKAGE_JSON = 'package.json'

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

function read_tsx_bin_entry(manifest_path: string): string | undefined {
	const { bin } = package_bin_schema.parse(JSON.parse(readFileSync(manifest_path, 'utf8')))

	return typeof bin === 'string' ? bin : bin?.[TSX_BIN]
}

// pnpm's generated `node_modules/.bin/tsx` shim hardcodes the absolute store path of the tsx
// version present when it was written. After a tsx bump the old store entry is pruned but the
// nested shim is not regenerated, so spawning it dies with MODULE_NOT_FOUND. Locating the CLI
// entry through tsx's own manifest at runtime never consults that stale artifact.
function resolve_tsx_cli_from(base_directory: string): string | undefined {
	try {
		const resolve_from = createRequire(path.join(base_directory, PACKAGE_JSON))
		const manifest_path = resolve_from.resolve(TSX_MANIFEST)
		const bin_entry = read_tsx_bin_entry(manifest_path)
		if (bin_entry === undefined) return undefined

		const cli_entry = path.join(path.dirname(manifest_path), bin_entry)

		return existsSync(cli_entry) ? cli_entry : undefined
	} catch {
		return undefined
	}
}

function resolve_tsx_cli_entry(): string | undefined {
	for (const base_directory of [PACKAGE_DIR, process.cwd()]) {
		const cli_entry = resolve_tsx_cli_from(base_directory)
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

function run_script_entry(entry: CommandEntry, subcommand_arguments: Array<string>): number {
	const runner = resolve_tsx_runner()
	const script_arguments = [
		...runner.leading_arguments,
		...(entry.tsx_arguments ?? []),
		path.join(PACKAGE_DIR, entry.script ?? ''),
		...(entry.default_script_arguments ?? []),
		...subcommand_arguments,
	]

	return spawn_script(runner.executable, script_arguments)
}

function run_command(cmd: string, subcommand_arguments: Array<string>): number {
	const resolved = resolve_alias(cmd)
	const entry = Object.hasOwn(COMMAND_MAP, resolved) ? COMMAND_MAP[resolved] : undefined

	if (!entry) return -1

	const rejection = composite_arguments.reject_extra_arguments(
		resolved,
		entry,
		subcommand_arguments,
	)

	if (rejection !== undefined) {
		console.error(rejection)

		return USAGE_ERROR_EXIT_CODE
	}

	if (entry.shell) return run_shell_command(entry.shell, subcommand_arguments)

	return run_script_entry(entry, subcommand_arguments)
}

const josh_logic = { format_help, run_command, spawn_script, run_shell_command }

export type { CommandEntry } from './josh-command-map'
export { ALIASES, COMMAND_MAP } from './josh-command-map'
export type { TsxRunner }
export { SPAWN_ERROR_EXIT_CODE } from '#scripts/spawn-exit'
export { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh-composite-arguments'
export { josh_logic, resolve_alias, resolve_tsx_executable, resolve_tsx_runner }
