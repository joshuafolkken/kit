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
	latest: {
		shell: ['sh', '-c', 'corepack use pnpm@latest && pnpm update --latest && josh audit'],
		description: 'Update pnpm, dependencies, and run security audit',
		category: 'Maintenance',
	},
	'latest:corepack': {
		shell: ['corepack', 'use', 'pnpm@latest'],
		description: 'Update pnpm via corepack',
		category: 'Maintenance',
	},
	'latest:update': {
		shell: ['pnpm', 'update', '--latest'],
		description: 'Update all dependencies to latest',
		category: 'Maintenance',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { MAINTENANCE_COMMANDS }
