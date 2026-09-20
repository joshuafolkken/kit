import type { CommandEntry } from './josh-command-types'

// The clone-detection commands, kept in their own module so `josh-commands-ai.ts` stays under its
// line ceiling as the AI-tools set grows (joshuafolkken/kit#2217). Spread into `COMMAND_MAP` in
// `josh-command-map.ts` alongside the other command groups.
/* eslint-disable @typescript-eslint/naming-convention */
const CLONE_COMMANDS: Record<string, CommandEntry> = {
	'clone:scan': {
		script: 'scripts/clone/clone-scan-cli.ts',
		description:
			'Count code duplication across files and first-party repositories, printing each clone as file:line pairs',
		category: 'AI tools',
		reference: ['', 'automation', ['files']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { CLONE_COMMANDS }
