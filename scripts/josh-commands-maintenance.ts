import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const MAINTENANCE_COMMANDS: Record<string, CommandEntry> = {
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
	'reconcile-templates': {
		script: 'scripts/reconcile-templates.ts',
		description: 'Record template source hashes (--check to verify drift)',
		category: 'Maintenance',
	},
	latest: {
		shell: [
			'sh',
			'-c',
			'export NODE_AUTH_TOKEN=$(gh auth token) && pnpm josh latest:corepack && pnpm josh latest:update && pnpm josh audit',
		],
		description: 'Update pnpm, dependencies, and run security audit',
		category: 'Maintenance',
	},
	'latest:corepack': {
		script: 'scripts/latest-corepack.ts',
		description: 'Update pnpm via corepack to the latest release on the current major',
		category: 'Maintenance',
	},
	'latest:update': {
		script: 'scripts/latest-update.ts',
		description: 'Update all dependencies to latest',
		category: 'Maintenance',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { MAINTENANCE_COMMANDS }
