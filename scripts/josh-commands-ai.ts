import type { CommandEntry } from './josh-command-types'

const AI_COMMANDS: Record<string, CommandEntry> = {
	prep: {
		script: 'scripts-ai/prep.ts',
		description: 'Pre-implementation preparation',
		category: 'AI tools',
	},
	issue: {
		script: 'scripts-ai/issue-prep.ts',
		description: 'Fetch GitHub issue details',
		category: 'AI tools',
	},
}

export { AI_COMMANDS }
