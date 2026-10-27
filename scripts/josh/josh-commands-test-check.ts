import { gate_plan } from '#scripts/gate/gate-plan'
import type { CommandEntry } from './josh-command-types'

// The commands that check a change's tests rather than run them, split out of
// `josh-commands-development.ts` when it reached its line cap (joshuafolkken/kit#5153). `DEV_COMMANDS`
// spreads this in at the same place, so the map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
const TEST_CHECK_COMMANDS: Record<string, CommandEntry> = {
	'test:declared': {
		script: 'scripts/test/test-declared.ts',
		description:
			'Report whether the working-tree change needs a test (required/exempt/satisfied); --match checks Step 0 declarations on stdin',
		category: 'Development',
		reference: ['[--match]', 'developer', ['processes']],
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: '--match', note: 'check Step 0 declarations on stdin' },
				{ arguments: '--help', note: 'print usage, including the --match stdin form' },
			],
		},
	},
	'test:red': {
		script: 'scripts/test/test-red-main.ts',
		description:
			'Run the changed unit tests against the pre-fix tree (merge-base worktree) and report red/green/no-test/stopped/test-only',
		category: 'Development',
		reference: ['', 'developer', ['git', 'processes']],
		usage: { examples: [{ arguments: '', note: 'red, green, no-test, stopped or test-only' }] },
	},
	'test:pinned': {
		script: 'scripts/test/test-pinned-main.ts',
		description:
			"Revert each changed hunk outside tests and fixtures only they reach, and replace each added file's top-level function bodies with a throw, in a HEAD worktree, run the related tests, and list what no test went red on",
		category: 'Development',
		reference: [
			'[--max <n>] [--record <token>] [--first-unpinned]',
			'developer',
			['git', 'processes'],
		],
		...gate_plan.DIRECT_UNIT_CLAIM,
		usage: {
			examples: [
				{ arguments: '', note: 'unpinned <file>:<line> lines; unchecked counted per reason' },
				{ arguments: '--max 5', note: 'check at most 5 hunks; the rest count as unchecked' },
				{
					arguments: '--record <token>',
					note: 'also leave the answer, under the launch token, for run:review --join',
				},
				{
					arguments: '--first-unpinned',
					note: 'start no probe once one hunk is unpinned; the rest count as unchecked',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { TEST_CHECK_COMMANDS }
