import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const VERSIONING_COMMANDS: Record<string, CommandEntry> = {
	bump: {
		script: 'scripts/version/bump-version.ts',
		description: 'Bump package version',
		category: 'Versioning',
	},
	version: {
		script: 'scripts/version/version-check.ts',
		description: 'Show global, project, and latest @joshuafolkken/kit versions',
		category: 'Versioning',
	},
	'version:upgrade': {
		script: 'scripts/version/version-update.ts',
		description: 'Upgrade @joshuafolkken/kit to latest for both global and project',
		category: 'Versioning',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { VERSIONING_COMMANDS }
