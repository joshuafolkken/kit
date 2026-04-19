import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const COLUMN_WIDTH = 24
const TSX_BIN = 'tsx'

function resolve_tsx_executable(): string {
	const candidates = [
		path.join(PACKAGE_DIR, 'node_modules', '.bin', TSX_BIN),
		path.join(process.cwd(), 'node_modules', '.bin', TSX_BIN),
	]

	return candidates.find(existsSync) ?? TSX_BIN
}

function read_package_version(): string {
	const parsed = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
		version: string
	}

	return parsed.version
}

const ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file=.env']

type CommandCategory =
	| 'Project'
	| 'Workflow'
	| 'Versioning'
	| 'Maintenance'
	| 'Git hooks'
	| 'AI tools'

interface CommandEntry {
	script: string
	description: string
	category: CommandCategory
	tsx_arguments?: ReadonlyArray<string>
}

const CATEGORY_ORDER: ReadonlyArray<CommandCategory> = [
	'Project',
	'Workflow',
	'Versioning',
	'Maintenance',
	'Git hooks',
	'AI tools',
]

const COMMAND_MAP: Record<string, CommandEntry> = {
	init: {
		script: 'scripts/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
	},
	sync: { script: 'scripts/sync.ts', description: 'Sync config files', category: 'Project' },
	install: {
		script: 'scripts/install-bin.ts',
		description: 'Install josh to ~/.local/bin',
		category: 'Project',
	},
	git: {
		script: 'scripts-ai/git-workflow.ts',
		description: 'Git workflow helper',
		category: 'Workflow',
	},
	followup: {
		script: 'scripts-ai/git-followup-workflow.ts',
		description: 'Follow-up git workflow',
		category: 'Workflow',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	notify: {
		script: 'scripts-ai/telegram-test.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	bump: {
		script: 'scripts/bump-version.ts',
		description: 'Bump package version',
		category: 'Versioning',
	},
	version: {
		script: 'scripts/version-check.ts',
		description: 'Show current and latest @joshuafolkken/kit version',
		category: 'Versioning',
	},
	overrides: {
		script: 'scripts/overrides-check.ts',
		description: 'Check pnpm overrides for drift',
		category: 'Maintenance',
	},
	audit: {
		script: 'scripts/security-audit.ts',
		description: 'Run security audit',
		category: 'Maintenance',
	},
	'prevent-main-commit': {
		script: 'scripts/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
		category: 'Git hooks',
	},
	'check-commit-message': {
		script: 'scripts/check-commit-message.ts',
		description: 'Git hook: validate commit message',
		category: 'Git hooks',
	},
	prep: {
		script: 'scripts-ai/prep.ts',
		description: 'Pre-implementation preparation',
		category: 'AI tools',
	},
	issue: {
		script: 'scripts-ai/issue-prep.ts',
		description: 'Fetch GitHub issue details',
		category: 'AI tools',
	},
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

function run_command(cmd: string, subcommand_arguments: Array<string>): number {
	const entry = Object.hasOwn(COMMAND_MAP, cmd) ? COMMAND_MAP[cmd] : undefined

	if (!entry) return -1

	const tsx_executable = resolve_tsx_executable()
	const script_arguments = [
		...(entry.tsx_arguments ?? []),
		path.join(PACKAGE_DIR, entry.script),
		...subcommand_arguments,
	]

	return spawn_script(tsx_executable, script_arguments)
}

const josh_logic = { format_help, run_command }

export type { CommandEntry }
export { COMMAND_MAP, josh_logic, resolve_tsx_executable }
