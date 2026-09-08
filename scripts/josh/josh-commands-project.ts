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
	},
	sync: { script: 'scripts/sync/sync.ts', description: 'Sync config files', category: 'Project' },
	'sync:scope': {
		script: 'scripts/sync/managed-config-scope-cli.ts',
		description: 'Say whether this change touches a file josh sync distributes',
		category: 'Project',
	},
	propagate: {
		script: 'scripts/propagate/propagate.ts',
		description: 'Carry the published release into every consumer repository next to this one',
		category: 'Project',
	},
	adopt: {
		script: 'scripts/adopt/adopt.ts',
		description: 'Upgrade every installed @joshuafolkken toolkit here and open the pull request',
		category: 'Project',
	},
}

export { PROJECT_COMMANDS }
