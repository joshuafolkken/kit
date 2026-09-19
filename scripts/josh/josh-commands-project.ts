import type { CommandEntry } from './josh-command-types'

// Command names are the CLI's, not TypeScript's: a scoped one carries a colon (`sync:scope`), which
// no identifier format allows. The same disable sits at the top of `josh-commands-maintenance.ts`
// for the same reason.
/* eslint-disable @typescript-eslint/naming-convention */
const PROJECT_COMMANDS: Record<string, CommandEntry> = {
	init: {
		script: 'scripts/init/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
		reference: ['', 'developer', ['files', 'processes']],
	},
	sync: {
		script: 'scripts/sync/sync.ts',
		description: 'Sync config files',
		category: 'Project',
		reference: ['', 'developer', ['files']],
	},
	'sync:scope': {
		script: 'scripts/sync/managed-config-scope-cli.ts',
		description: 'Say whether this change touches a file josh sync distributes',
		category: 'Project',
		reference: ['[--staged] [--json]', 'automation', ['none']],
	},
	propagate: {
		script: 'scripts/propagate/propagate.ts',
		description: 'Carry the published release into every consumer repository next to this one',
		category: 'Project',
		reference: ['[--dry-run] [--skip-publish-wait]', 'maintainer', ['files', 'network']],
	},
	adopt: {
		script: 'scripts/adopt/adopt.ts',
		description: 'Upgrade every installed @joshuafolkken toolkit here and open the pull request',
		category: 'Project',
		reference: ['[--dry-run]', 'developer', ['files', 'git', 'network', 'processes']],
	},
}

export { PROJECT_COMMANDS }
