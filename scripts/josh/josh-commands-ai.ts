import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
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
	epic: {
		script: 'scripts-ai/epic.ts',
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
	},
	'epic:check': {
		script: 'scripts-ai/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
