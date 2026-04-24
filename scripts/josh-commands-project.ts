import type { CommandEntry } from './josh-command-types'

const PROJECT_COMMANDS: Record<string, CommandEntry> = {
	init: {
		script: 'scripts/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
	},
	sync: { script: 'scripts/sync.ts', description: 'Sync config files', category: 'Project' },
	install: {
		script: 'scripts/install-bin.ts',
		description: 'Install josh to ~/.local/bin',
		category: 'Project',
	},
}

export { PROJECT_COMMANDS }
