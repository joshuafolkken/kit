import type { CommandEntry } from './josh-command-types'

// The `split:assess` command registry, split out of `josh-commands-ai.ts` so that file stays under its
// 300-code-line limit, exactly as `LANE_COMMANDS` was for the same reason (joshuafolkken/kit#2162,
// joshuafolkken/kit#2218). It is spread into `AI_COMMANDS` so the command stays grouped with the other
// decision oracles under the 'AI tools' category.

/* eslint-disable @typescript-eslint/naming-convention */
const SPLIT_COMMANDS: Record<string, CommandEntry> = {
	'split:assess': {
		script: 'scripts/split/split-assess-cli.ts',
		description:
			'Measure the branch change size (tests excluded) and answer the split assessment size question: split | single',
		category: 'AI tools',
		reference: ['[--json]', 'automation', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { SPLIT_COMMANDS }
