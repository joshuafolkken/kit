import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { import_graph, type FileGraph } from '#scripts/refactor/import-graph'
import { describe, expect, it } from 'vitest'
import { COMMAND_MAP, type CommandEntry } from './josh-command-map'
import { OPTIONAL_ENV_FILE_FLAGS } from './josh-command-types'

// joshuafolkken/kit#3357: `run:carry --stopped` sends the stop confirmation, yet it read no `.env`, so
// from a person's terminal the only interrupt a stopped run raises never arrived. Which commands reach
// Telegram is computed from the import graph rather than listed, so a new path to `telegram-notify.ts`
// cannot be added without its command loading the credentials.

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPTS_DIR = path.join(PACKAGE_DIR, 'scripts')
const TELEGRAM_MODULE = path.join(SCRIPTS_DIR, 'notify', 'telegram-notify.ts')
// The in-script loader a command that must stay in-process calls instead of the flag, and the hook
// namespace that re-exports it for the hooks (`hook-decision.ts`).
const ENVIRONMENT_LOADERS: ReadonlyArray<string> = [
	path.join(SCRIPTS_DIR, 'josh', 'josh-environment-file.ts'),
	path.join(SCRIPTS_DIR, 'josh', 'hook-decision.ts'),
]
const SOURCE_PATTERN = /(?<!\.test)\.ts$/u

function source_files(): ReadonlyArray<string> {
	const entries = readdirSync(SCRIPTS_DIR, { recursive: true, encoding: 'utf8' })

	return entries
		.filter((entry) => SOURCE_PATTERN.test(entry))
		.map((entry) => path.join(SCRIPTS_DIR, entry))
}

function has_environment_flag(entry: CommandEntry): boolean {
	return OPTIONAL_ENV_FILE_FLAGS.every((flag) => entry.tsx_arguments?.includes(flag) === true)
}

// The flag, or an entry script that imports the loader itself — the loader's own rule is to call it
// only on the real command path, so the entry script is where it is imported.
function loads_environment(entry: CommandEntry, entry_file: string, forward: FileGraph): boolean {
	const imports = forward.get(entry_file)

	return has_environment_flag(entry) || ENVIRONMENT_LOADERS.some((file) => imports?.has(file))
}

function is_missing_environment(entry: CommandEntry, forward: FileGraph): boolean {
	if (entry.script === undefined) return false
	const entry_file = path.join(PACKAGE_DIR, entry.script)
	const is_reaching = import_graph.reachable(entry_file, forward).has(TELEGRAM_MODULE)

	return is_reaching && !loads_environment(entry, entry_file, forward)
}

function commands_missing_environment(forward: FileGraph): ReadonlyArray<string> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => is_missing_environment(entry, forward))
		.map(([name]) => name)
}

describe('COMMAND_MAP — commands that reach Telegram load .env', () => {
	const forward = import_graph.build_forward(source_files(), PACKAGE_DIR)

	it('finds the Telegram module in the import graph', () => {
		expect(forward.has(TELEGRAM_MODULE)).toBe(true)
	})

	it('every command whose script reaches telegram-notify loads .env', () => {
		expect(commands_missing_environment(forward)).toStrictEqual([])
	})
})
