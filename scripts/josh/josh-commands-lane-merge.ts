import type { CommandEntry } from './josh-command-types'

// `lane:resolve`, split out of `josh-commands-lane.ts` so that file stays under its 300-code-line
// limit. `LANE_COMMANDS` spreads this in after `lane:withdraw`.

/* eslint-disable @typescript-eslint/naming-convention */
const LANE_MERGE_COMMANDS: Record<string, CommandEntry> = {
	'lane:resolve': {
		script: 'scripts/lane/lane-resolve-cli.ts',
		description:
			"Merge the default branch into a lane's branch and print one verdict — resolved, conflict <paths>, or step-back 2 (overlapping hunks, merge aborted) / 3 (a resolution already recorded on the issue)",
		category: 'AI tools',
		reference: ['<issue>', 'developer', ['git', 'network', 'files']],
		usage: {
			examples: [
				{ arguments: '3769', note: 'prints `conflict docs/a.md` on a hand-resolvable conflict' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { LANE_MERGE_COMMANDS }
