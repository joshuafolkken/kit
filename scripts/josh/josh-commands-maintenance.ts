import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const MAINTENANCE_COMMANDS: Record<string, CommandEntry> = {
	doctor: {
		script: 'scripts/doctor/doctor.ts',
		description:
			'Diagnose PATH shadowing of the global josh and show the discovered repository map (--fix reclaims a stale shim)',
		category: 'Maintenance',
		reference: ['[--fix]', 'developer', ['files']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	overrides: {
		script: 'scripts/overrides/overrides-check.ts',
		description: 'Check pnpm overrides for drift',
		category: 'Maintenance',
		reference: ['[--save]', 'maintainer', ['files']],
	},
	audit: {
		script: 'scripts/security/security-audit.ts',
		description: 'Run security audit',
		category: 'Maintenance',
		reference: ['', 'developer', ['processes']],
	},
	'audit:provision': {
		script: 'scripts/security/security-audit-provision.ts',
		description: 'Install the pinned osv-scanner when the audit cannot find one (no-op if present)',
		category: 'Maintenance',
		reference: ['', 'automation', ['files', 'network']],
	},
	'reconcile-templates': {
		script: 'scripts/sync/reconcile-templates.ts',
		description: 'Record template source hashes (--check to verify drift)',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files']],
	},
	latest: {
		shell: [
			'sh',
			'-c',
			'export NODE_AUTH_TOKEN=$(gh auth token) && pnpm josh latest:guard && pnpm josh latest:corepack && pnpm josh latest:update && pnpm josh ranges && pnpm josh audit && pnpm josh latest:scope --record',
		],
		description: 'Update pnpm, dependencies, and run security audit',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files', 'network', 'processes']],
		argument_targets: ['latest:corepack', 'latest:update', 'audit'],
	},
	'latest:scope': {
		script: 'scripts/version/latest-scope-cli.ts',
		description:
			'Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run)',
		category: 'Maintenance',
		reference: ['[--record] [--json]', 'automation', ['files']],
		// `JOSH_LATEST_MAX_AGE_HOURS` is documented as a project setting, so it has to be readable
		// where the project keeps its settings — a variable that only works when exported from the
		// shell is one a user follows the documentation for and gets the default from, silently.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	'latest:guard': {
		script: 'scripts/version/latest-lane-guard.ts',
		description: 'Refuse josh latest inside a lane (the update stamp is keyed to the project root)',
		category: 'Maintenance',
		reference: ['', 'automation', ['files']],
	},
	'latest:corepack': {
		script: 'scripts/version/latest-corepack.ts',
		description: 'Update pnpm via corepack to the latest release on the current major',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files', 'network']],
	},
	'latest:update': {
		script: 'scripts/version/latest-update.ts',
		description: 'Update all dependencies to latest',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files', 'network']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { MAINTENANCE_COMMANDS }
