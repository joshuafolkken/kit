import type { CommandEntry } from './josh-command-types'

const VERSIONING_COMMANDS: Record<string, CommandEntry> = {
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
}

export { VERSIONING_COMMANDS }
