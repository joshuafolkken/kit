import { ports } from '#ports'
import { core_weights } from '#scripts/gate/core-weights'
import { gate_plan } from '#scripts/gate/gate-plan'
import { GATE_COMMAND, type CommandEntry } from './josh-command-types'
import { AGENT_HOOK_COMMANDS } from './josh-commands-agent-hooks'
import { TEST_CHECK_COMMANDS } from './josh-commands-test-check'

const NARROWED = { arguments: 'scripts/thing.ts', note: 'narrow by the given files instead' }
// The unseeded ports are read from `ports/index.js`, their one definition (#818).
const UNSEEDED: Readonly<Record<string, string | undefined>> = {}

const FILE_ARGUMENTS = '[files...]'
const REQUIRED_FILE_ARGUMENTS = '<files...>'
const FILTER_ARGUMENTS = '[filters...]'
const PATH_ARGUMENTS = '<path...>'

/* eslint-disable @typescript-eslint/naming-convention */
const DEV_COMMANDS: Record<string, CommandEntry> = {
	'pr:classification': {
		script: 'scripts/ci/pr-classification-main.ts',
		description: 'Require one release classification on a pull request',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '', note: 'run by CI on a pull request; fails without one label' }],
		},
	},
	[GATE_COMMAND]: {
		script: 'scripts/gate/verification-gate.ts',
		description: 'Run lint, type check, spell check and unit tests concurrently',
		category: 'Development',
		reference: [
			'[--verbose|--force|--no-unit|--static-group=<group>]',
			'developer',
			['files', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: '--verbose', note: "every check's output, passing ones included" },
				{ arguments: '--force', note: 're-run even on a tree already recorded green' },
				{ arguments: '--no-unit', note: 'the static checks only (CI only)' },
			],
		},
	},
	lint: {
		script: 'scripts/lint/lint-parallel-main.ts',
		description: 'Check code with prettier and eslint (skips a tool a basic project lacks)',
		category: 'Development',
		reference: ['[--changed]', 'developer', ['processes']],
		core_weight: core_weights.CORE_WEIGHTS.lint,
		memory_mb: core_weights.MEMORY_MB.lint,
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: '--changed', note: "the branch's changed files — the gate's form" },
			],
		},
	},
	'lint:related': {
		script: 'scripts/lint/lint-related.ts',
		description:
			'Check only the changed files with prettier and eslint, and in kit the source guard tests (whole tree on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
		core_weight: core_weights.CORE_WEIGHTS.lint,
		memory_mb: core_weights.MEMORY_MB.lint,
		usage: { examples: [{ arguments: '' }, NARROWED] },
	},
	lines: {
		script: 'scripts/lines/lines-command.ts',
		description: "Print a file's code lines against the max-lines limit and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
		core_weight: core_weights.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_weights.MEMORY_MB.eslint_scan,
		usage: {
			examples: [{ arguments: 'scripts/hooks/format-edited-file.ts scripts/josh/josh-logic.ts' }],
		},
	},
	metrics: {
		script: 'tools/metrics/metrics-command.ts',
		description:
			'Print repository-wide quality totals and durations, and fail when a total grew past the merge-base or a duration past its baseline',
		category: 'Development',
		reference: [
			'[--no-startup | --totals-only [--rerecord] | --accept --reason "<why>"]',
			'developer',
			['files'],
		],
		core_weight: core_weights.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_weights.MEMORY_MB.metrics,
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: "print the totals and check them against the merge-base's" },
				{ arguments: '--accept --reason "<why>"', note: "record this branch's growth and why" },
			],
		},
	},
	'refactor:scan': {
		script: 'scripts/refactor/refactor-scan-cli.ts',
		description:
			'List refactoring candidates in the changed scope by category and answer clear/candidates',
		category: 'Development',
		reference: ['', 'automation', ['processes']],
		core_weight: core_weights.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_weights.MEMORY_MB.eslint_scan,
		usage: { examples: [{ arguments: '' }] },
	},
	bytes: {
		script: 'scripts/lines/bytes-command.ts',
		description:
			"Print an agent-read document's byte size against its ceiling and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
		usage: {
			examples: [
				{ arguments: 'docs/josh-commands.md', note: 'one document' },
				{ arguments: '', note: 'scan: every budgeted document near its ceiling' },
			],
		},
	},
	'rule:value': {
		script: 'scripts/rules/rule-value-cli.ts',
		description:
			"Print each delivered rule's unaided compliance — runs reached, kept rate, refusals",
		category: 'AI tools',
		reference: ['[--fresh | --refresh]', 'developer', ['files']],
		usage: {
			examples: [
				{ arguments: '', note: 'a reading cached under 15 minutes ago, else measure' },
				{ arguments: '--fresh', note: 'measure now, whatever the cache holds' },
				{
					arguments: '--refresh',
					note: 'write the reading to the loop-head cache instead of stdout',
				},
			],
		},
	},
	'rule:list': {
		script: 'scripts/rules/rule-list.ts',
		description:
			"Print the trigger-delivered rules — each one's source, firing call and silent turn — from the guard rows",
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: 'print every trigger-delivered rule' }] },
	},
	format: {
		script: 'scripts/lint/format.ts',
		description: 'Format code with prettier and eslint (skips a tool a basic project lacks)',
		category: 'Development',
		reference: ['', 'developer', ['files', 'processes']],
		usage: { examples: [{ arguments: '' }] },
	},
	rename: {
		script: 'scripts/lint/rename-cli.ts',
		description:
			'Rename an identifier, and the import specifier it moved with, across files through the TypeScript parse tree',
		category: 'Development',
		reference: [
			'<old-identifier> <new-identifier> [--import <old-specifier> <new-specifier>] <file...>',
			'automation',
			['files', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: 'old_name new_name scripts/a.ts scripts/b.ts' },
				{
					arguments:
						"lane_ledger lane_ledger_write --import '#scripts/lane/lane-ledger' '#scripts/lane/lane-ledger-write' scripts/gate/core-wait-record.ts",
					note: 'the identifier and its module together',
				},
			],
		},
	},
	...AGENT_HOOK_COMMANDS,
	'cspell:dot': {
		script: 'scripts/lint/cspell-cached.ts',
		description: 'Run spell check including dotfiles',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		core_weight: core_weights.CORE_WEIGHTS.spell_check,
		memory_mb: core_weights.MEMORY_MB.spell_check,
		usage: { examples: [{ arguments: '', note: 'includes dotfiles' }] },
	},
	'check:related': {
		script: 'scripts/gate/check-related.ts',
		description:
			'Run related lint, type and dotfile spelling checks in parallel, and the unit tests once lint passes',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		usage: {
			examples: [{ arguments: '' }, { arguments: '--full', note: 'whole outputs' }],
		},
	},
	behavior: {
		script: 'scripts/behavior/behavior-cli.ts',
		description:
			"Check the current run's recorded transcript against the behavior assertions (no model call)",
		category: 'Development',
		reference: ['', 'developer', ['files']],
		usage: { examples: [{ arguments: '' }] },
	},
	'exports:unused': {
		script: 'scripts/exports/unused-members-cli.ts',
		description:
			'Report exported namespace members nothing reads (kit only; a consumer project skips it)',
		category: 'Development',
		reference: ['', 'developer', ['none']],
		usage: { examples: [{ arguments: '' }] },
	},
	'test:unit': {
		script: 'scripts/test/test-unit-guard-main.ts',
		description:
			'Run unit tests with Vitest (without Vitest: a basic project runs its own test script, others skip; fails when Vitest has no tests)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
		...gate_plan.DIRECT_UNIT_CLAIM,
		usage: { examples: [{ arguments: '' }] },
	},
	'test:related': {
		script: 'scripts/test/test-related-main.ts',
		description: 'Run only the unit tests related to the changed files (full suite on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
		usage: {
			examples: [
				{ arguments: '' },
				NARROWED,
				{ arguments: '--touched', note: "only the diff's tests and its modules' same-named ones" },
				{ arguments: '--silent', note: 'flags are forwarded to vitest' },
			],
		},
	},
	...TEST_CHECK_COMMANDS,
	disposition: {
		script: 'scripts/review/disposition-cli.ts',
		description:
			'Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime)',
		category: 'AI tools',
		reference: [PATH_ARGUMENTS, 'automation', ['none']],
		usage: { examples: [{ arguments: '<path...>', note: '→ runtime | non-runtime' }] },
	},
	'e2e:retry-check': {
		script: 'scripts/test/e2e-retry-check.ts',
		description: 'Report whether the preview server crashed during a failed E2E attempt (CI)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '' }] },
	},
	'test:e2e': {
		script: 'scripts/test/test-e2e-guard.ts',
		description: 'Run E2E tests with Playwright (skips when absent or no e2e files)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
		usage: { examples: [{ arguments: '' }] },
	},
	test: {
		shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
		description: 'Run unit and E2E tests',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		argument_targets: ['test:unit', 'test:e2e'],
		usage: { examples: [{ arguments: '' }] },
	},
	check: {
		script: 'scripts/gate/type-check-command.ts',
		description: 'Type-check with tsc (skips a basic project with no TypeScript to check)',
		category: 'Development',
		reference: ['[arguments...]', 'developer', ['processes']],
		core_weight: core_weights.CORE_WEIGHTS.type_check,
		memory_mb: core_weights.MEMORY_MB.type_check,
		usage: { examples: [{ arguments: '' }] },
	},
	port: {
		script: 'scripts/ports/port-command.ts',
		description: 'Print the PORT_SEED-resolved dev or preview port',
		category: 'Development',
		reference: ['<dev|preview>', 'developer', ['none']],
		usage: {
			examples: [
				{
					arguments: 'dev',
					note: `${String(ports.resolve_development_port(UNSEEDED))} with no seed set`,
				},
				{
					arguments: 'preview',
					note: `${String(ports.resolve_preview_port(UNSEEDED))} with no seed set`,
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEV_COMMANDS }
