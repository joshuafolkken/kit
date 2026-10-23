import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// `run:pause`, split out of `josh-commands-run.ts` so that file stays under its 300-code-line limit,
// as `PROGRESS_COMMANDS` is. `RUN_COMMANDS` spreads this in after `run:release`, so the map keeps
// the order the run reads them in.

/* eslint-disable @typescript-eslint/naming-convention */
const PAUSE_COMMANDS: Record<string, CommandEntry> = {
	'run:pause': {
		script: 'scripts/run/pause/run-pause-cli.ts',
		description: 'Set a run aside while its prerequisite lands first',
		category: 'AI tools',
		// `run:release` underneath can send the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: ['<issue> --for <prerequisite>', 'automation', ['git', 'network', 'files']],
		usage: {
			examples: [{ arguments: '1091 --for 1102', note: 'pause 1091 until 1102 lands' }],
			flags: [
				{
					names: ['--for <prerequisite>'],
					description: 'the issue that has to land first; `<issue>` is recorded blocked by it.',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { PAUSE_COMMANDS }
