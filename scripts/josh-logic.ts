import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const COLUMN_WIDTH = 24
const ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file=.env']

interface CommandEntry {
	script: string
	description: string
	tsx_arguments?: ReadonlyArray<string>
}

const COMMAND_MAP: Record<string, CommandEntry> = {
	init: { script: 'scripts/init.ts', description: 'Initialize config in a new project' },
	sync: { script: 'scripts/sync.ts', description: 'Sync config files' },
	git: { script: 'scripts-ai/git-workflow.ts', description: 'Git workflow helper' },
	'git-followup': {
		script: 'scripts-ai/git-followup-workflow.ts',
		description: 'Follow-up git workflow',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	'telegram-test': {
		script: 'scripts-ai/telegram-test.ts',
		description: 'Send Telegram test notification',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	prep: { script: 'scripts-ai/prep.ts', description: 'Pre-implementation preparation' },
	'issue-prep': { script: 'scripts-ai/issue-prep.ts', description: 'Fetch GitHub issue details' },
	'bump-version': { script: 'scripts/bump-version.ts', description: 'Bump package version' },
	'overrides-check': {
		script: 'scripts/overrides-check.ts',
		description: 'Check pnpm overrides for drift',
	},
	'security-audit': { script: 'scripts/security-audit.ts', description: 'Run security audit' },
	'prevent-main-commit': {
		script: 'scripts/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
	},
	'check-commit-message': {
		script: 'scripts/check-commit-message.ts',
		description: 'Git hook: validate commit message',
	},
	'version-check': {
		script: 'scripts/version-check.ts',
		description: 'Show current and latest @joshuafolkken/config version',
	},
	install: {
		script: 'scripts/install-bin.ts',
		description: 'Install josh to ~/.local/bin',
	},
}

const HEADER = "josh — Joshua Folkken's dev toolkit"
const USAGE = 'Usage: josh <command> [options]'

function format_command_line(cmd: string, entry: CommandEntry): string {
	return `  ${cmd.padEnd(COLUMN_WIDTH)}${entry.description}`
}

function format_help(): string {
	const command_lines = Object.entries(COMMAND_MAP).map(([cmd, entry]) =>
		format_command_line(cmd, entry),
	)

	return [HEADER, '', 'Commands:', ...command_lines, '', USAGE].join('\n')
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
