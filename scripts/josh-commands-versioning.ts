import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
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
	'version:upgrade': {
		script: 'scripts/version-update.ts',
		description: 'Upgrade @joshuafolkken/kit to latest (global or project-local per invocation)',
		category: 'Versioning',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { VERSIONING_COMMANDS }
