import type { CommandEntry } from './josh-command-types'

// The linters for the fixed-shape artifacts a run writes by hand. They are
// `AI tools` by category, like every other automation command, but live in their own file so
// `josh-commands-ai.ts` stays under its line ceiling.

/* eslint-disable @typescript-eslint/naming-convention */
const LINT_COMMANDS: Record<string, CommandEntry> = {
	'issue:lint': {
		script: 'scripts/issue/issue-lint-cli.ts',
		description: "Check an issue body file for the template's required headings",
		category: 'AI tools',
		reference: ['<path>', 'automation', ['files']],
		usage: { examples: [{ arguments: '.josh/tmp/issue-body.md' }] },
	},
	'issue:backlinks': {
		script: 'scripts/issue/issue-backlinks-cli.ts',
		description: 'Classify an origin issue’s upstream backlinks: ok, missing, or wrong heading',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
		usage: { examples: [{ arguments: '2123' }] },
	},
	'report:lint': {
		script: 'scripts/report/report-lint-cli.ts',
		description: 'Check a two-layer work summary on stdin against its mechanical format rules',
		category: 'AI tools',
		reference: ['(reads stdin)', 'automation', ['none']],
		usage: { examples: [{ arguments: '< summary.md' }] },
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
			'Read changed paths and print the I/O boundaries crossed and their mandatory abnormal cases: network | process | fs | none',
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
