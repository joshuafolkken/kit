import type { CommandEntry } from './josh-command-types'

const PROJECT_COMMANDS: Record<string, CommandEntry> = {
	init: {
		script: 'scripts/init/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
	},
	sync: { script: 'scripts/sync/sync.ts', description: 'Sync config files', category: 'Project' },
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
