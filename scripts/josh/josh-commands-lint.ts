import { core_weights } from '#scripts/gate/core-weights'
import { LINT_RULE_WORKERS, type CommandEntry } from './josh-command-types'

// The linters for the fixed-shape artifacts a run writes by hand, plus `lint:rule`. They are
// `AI tools` by category, like every other automation command. Spread into `COMMAND_MAP` in
// `josh-command-map.ts` ahead of `CLONE_COMMANDS`.

const LINT_COMMANDS: Record<string, CommandEntry> = {
	'lint:rule': {
		script: 'scripts/lint/lint-rule.ts',
		description:
			"Run one eslint rule over the whole repository, or with --paths a subset, on a cache of its own and write the rule's violations to a file",
		category: 'Development',
		reference: [
			'<rule> [--config <path>] [--output <path>] [--paths <path>...]',
			'developer',
			['files', 'processes'],
		],
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
				{
					arguments: 'kit/no-measurement-comment --paths scripts/lint/*.ts',
					note: 'only these paths, on a subset cache and report',
				},
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
	'report:template': {
		script: 'scripts/report/report-template-cli.ts',
		description:
			"Print the work summary, completion report or lane child's summary skeleton in the session language: summary | done | child",
		category: 'AI tools',
		reference: ['summary|done|child [<path>...]', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: 'summary scripts/report/report-lint.ts' },
				{ arguments: 'done' },
				{ arguments: 'child' },
			],
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
	'plan:scaffold': {
		script: 'scripts/plan/plan-scaffold-cli.ts',
		description:
			"Print a work summary's inputs in one call: the run:prep skeleton, planned files near the line limit, the test:declared verdict, the owed cases and the plan:consumers draft",
		category: 'AI tools',
		reference: ['<issue> [<path>...]', 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '123', note: 'planned files from the issue body' },
				{ arguments: '123 scripts/a.ts scripts/b.ts', note: 'the files this plan touches' },
			],
		},
	},
}

export { LINT_COMMANDS }
