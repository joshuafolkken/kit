import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const COLUMN_WIDTH = 24
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
		description: 'Show current and latest @joshuafolkken/config version',
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

const HEADER = "josh — Joshua Folkken's dev toolkit"
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

function run_command(cmd: string, subcommand_arguments: Array<string>): number {
	const entry = Object.hasOwn(COMMAND_MAP, cmd) ? COMMAND_MAP[cmd] : undefined

	if (!entry) return -1

	/* eslint-disable sonarjs/no-os-command-from-path */
	const result = spawnSync(
		'tsx',
		[...(entry.tsx_arguments ?? []), path.join(PACKAGE_DIR, entry.script), ...subcommand_arguments],
		{ stdio: 'inherit' },
	)
	/* eslint-enable sonarjs/no-os-command-from-path */

	return result.status ?? 1
}

const josh_logic = { format_help, run_command }

export type { CommandEntry }
export { COMMAND_MAP, josh_logic }
