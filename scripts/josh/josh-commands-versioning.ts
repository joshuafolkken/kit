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
	// A `script` entry, not a shell one: script paths resolve against the kit package root, so this
	// keeps working from a consumer repo where the file lives under node_modules. The registry
	// probes need NODE_AUTH_TOKEN for any `@joshuafolkken/*` dependency; `josh latest` exports it
	// before chaining here, exactly as it already does for `latest:update`.
	ranges: {
		script: 'scripts/version/publishable-range-check.ts',
		description: 'Check that every published dependency range still resolves for a consumer',
		category: 'Versioning',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { VERSIONING_COMMANDS }
