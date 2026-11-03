import type { CommandEntry } from './josh-command-types'

// The clone-detection commands. Spread into `COMMAND_MAP` in `josh-command-map.ts` alongside the
// other command groups.
const CLONE_COMMANDS: Record<string, CommandEntry> = {
	'clone:scan': {
		script: 'scripts/clone/clone-scan-cli.ts',
		description:
			'Count code duplication across files and first-party repositories, printing each clone as file:line pairs',
		category: 'AI tools',
		reference: ['', 'automation', ['files']],
		usage: { examples: [{ arguments: '' }] },
	},
}

export { CLONE_COMMANDS }
