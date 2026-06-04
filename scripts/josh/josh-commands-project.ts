import type { CommandEntry } from './josh-command-types'

const PROJECT_COMMANDS: Record<string, CommandEntry> = {
	init: {
		script: 'scripts/init/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
	},
	sync: { script: 'scripts/sync/sync.ts', description: 'Sync config files', category: 'Project' },
}

export { PROJECT_COMMANDS }
