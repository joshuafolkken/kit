import { core_weights } from '#scripts/gate/core-weights'
import { LINT_RULE_WORKERS, type CommandEntry } from './josh-command-types'

// The linters for the fixed-shape artifacts a run writes by hand. They are
// `AI tools` by category, like every other automation command, but live in their own file so
// `josh-commands-ai.ts` stays under its line ceiling. `lint:rule` is here for the same reason:
// `josh-commands-development.ts`, where the other lint commands are, is at its line ceiling.

/* eslint-disable @typescript-eslint/naming-convention */
const LINT_COMMANDS: Record<string, CommandEntry> = {
	'lint:rule': {
		script: 'scripts/lint/lint-rule.ts',
		description:
			"Run one eslint rule over the whole repository on a cache of its own and write the rule's violations to a file",
		category: 'Development',
		reference: ['<rule> [--config <path>] [--output <path>]', 'developer', ['files', 'processes']],
		core_weight: LINT_RULE_WORKERS * core_weights.CORE_WEIGHTS.eslint_scan,
		memory_mb: LINT_RULE_WORKERS * core_weights.MEMORY_MB.eslint_scan,
		usage: {
			examples: [
				{ arguments: 'kit/no-measurement-comment' },
				{
					arguments: 'kit/no-measurement-comment --config eslint.tmp.config.js',
					note: 'a temporary config',
				},
				{ arguments: 'kit/no-measurement-comment --output .josh/tmp/violations.txt' },
			],
		},
	},
	'issue:lint': {
		script: 'scripts/issue/issue-lint-main.ts',
		description: "Check an issue body file for the template's required headings",
		category: 'AI tools',
		reference: ['<path>', 'automation', ['files']],
		usage: { examples: [{ arguments: '.josh/tmp/issue-body.md' }] },
	},
	'report:lint': {
		script: 'scripts/report/report-lint-cli.ts',
		description:
			"Check a two-layer work summary, or with --child-summary a lane child's summary, on stdin against its mechanical format rules",
		category: 'AI tools',
		reference: ['[--child-summary] (reads stdin)', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '< summary.md' }, { arguments: '--child-summary < summary.md' }],
		},
	},
	'review:lint': {
		script: 'scripts/review/review-lint-cli.ts',
		description:
			"Check a review's markdown on stdin against the review rubric's output format, round 1 or with --round 2 the verification pass",
		category: 'AI tools',
		reference: ['[--round <1|2>] (reads stdin)', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '< review.md' }, { arguments: '--round 2 < review.md' }],
		},
	},
	'report:template': {
		script: 'scripts/report/report-template-cli.ts',
		description:
			'Print the work summary or completion report skeleton in the session language: summary | done',
		category: 'AI tools',
		reference: ['summary|done [<path>...]', 'automation', ['files']],
		usage: {
			examples: [{ arguments: 'summary scripts/report/report-lint.ts' }, { arguments: 'done' }],
		},
	},
	cases: {
		script: 'scripts/cases/cases-cli.ts',
		description:
			'Read changed paths and print the boundaries crossed and their mandatory abnormal cases: network | process | fs | time | state | env | none',
		category: 'AI tools',
		reference: ['<path...>', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: 'scripts/a.ts scripts/b.ts', note: 'the boundaries these paths cross' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { LINT_COMMANDS }
