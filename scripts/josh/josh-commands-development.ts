import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import { GATE_COMMAND, type CommandEntry } from './josh-command-types'

const FILE_ARGUMENTS = '[files...]'
const REQUIRED_FILE_ARGUMENTS = '<files...>'
const FILTER_ARGUMENTS = '[filters...]'
const MATCH_ARGUMENTS = '[--match]'
const PATH_ARGUMENTS = '<path...>'

/* eslint-disable @typescript-eslint/naming-convention */
const DEV_COMMANDS: Record<string, CommandEntry> = {
	'pr:classification': {
		script: 'scripts/ci/pr-classification.ts',
		description: 'Require one release classification on a pull request',
		category: 'Development',
		reference: ['', 'automation', ['none']],
	},
	[GATE_COMMAND]: {
		script: 'scripts/gate/verification-gate.ts',
		description: 'Run lint, type check, spell check and unit tests concurrently',
		category: 'Development',
		reference: ['[--verbose|--force|--no-unit]', 'developer', ['files', 'processes']],
	},
	lint: {
		script: 'scripts/lint/lint-parallel.ts',
		description: 'Check code with prettier and eslint (skips a tool a basic project lacks)',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		core_weight: core_budget.CORE_WEIGHTS.lint,
		memory_mb: core_budget.MEMORY_MB.lint,
	},
	'lint:related': {
		script: 'scripts/lint/lint-related.ts',
		description: 'Check only the changed files with prettier and eslint (whole tree on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
		core_weight: core_budget.CORE_WEIGHTS.lint,
		memory_mb: core_budget.MEMORY_MB.lint,
	},
	lines: {
		script: 'scripts/lines/lines-command.ts',
		description: "Print a file's code lines against the max-lines limit and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
		core_weight: core_budget.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_budget.MEMORY_MB.eslint_scan,
	},
	metrics: {
		script: 'scripts/metrics/metrics-command.ts',
		description:
			'Print repository-wide quality totals and durations, and fail when one grew past its baseline',
		category: 'Development',
		reference: [
			'[--no-startup | --totals-only | --accept --reason "<why>"]',
			'developer',
			['files'],
		],
		core_weight: core_budget.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_budget.MEMORY_MB.eslint_scan,
		is_kit_only: true,
	},
	'refactor:scan': {
		script: 'scripts/refactor/refactor-scan-cli.ts',
		description:
			'List refactoring candidates in the changed scope by category and answer clear/candidates',
		category: 'Development',
		reference: ['', 'automation', ['processes']],
		core_weight: core_budget.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_budget.MEMORY_MB.eslint_scan,
	},
	bytes: {
		script: 'scripts/lines/bytes-command.ts',
		description:
			"Print an agent-read document's byte size against its ceiling and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
	},
	'rule:value': {
		script: 'scripts/rules/rule-value-cli.ts',
		description:
			"Print each delivered rule's unaided compliance — runs reached, kept rate, refusals",
		category: 'AI tools',
		reference: ['[--refresh]', 'developer', ['files']],
	},
	'rule:list': {
		script: 'scripts/rules/rule-list.ts',
		description:
			"Print the trigger-delivered rules — each one's source, firing call and silent turn — from the guard rows",
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	format: {
		script: 'scripts/lint/format.ts',
		description: 'Format code with prettier and eslint (skips a tool a basic project lacks)',
		category: 'Development',
		reference: ['', 'developer', ['files', 'processes']],
	},
	'format:edited': {
		script: 'scripts/hooks/format-edited-cli.ts',
		description: 'Claude Code hook: format the file just edited (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['files', 'processes']],
	},
	'batch:guard': {
		script: 'scripts/hooks/batch-guard.ts',
		description:
			'Claude Code hook: refuse a third consecutive single-call turn (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately.** `JOSH_BATCH_GUARD` is a per-machine preference kept in
		// `.env`, which every other command reads through `OPTIONAL_ENV_FILE_FLAGS` — but declaring any
		// `tsx_arguments` disqualifies a command from in-process dispatch (`josh-in-process.ts`), and
		// this one runs before every `Bash` call, where a second ~0.16 s tsx start is not affordable.
		// The script calls `process.loadEnvFile` itself instead, which is
		// node's own `--env-file` parser with node's own precedence.
	},
	'pretool:guard': {
		script: 'scripts/hooks/pretool-guard-cli.ts',
		description:
			'Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `batch:guard` above: this is the one
		// PreToolUse hook consumers run before every guarded call, so it must stay eligible for
		// in-process dispatch rather than pay a second tsx start. Each guard it composes loads `.env`
		// through the shared loader.
	},
	'stop:guard': {
		script: 'scripts/hooks/stop-guard.ts',
		description:
			'Claude Code Stop hook: deliver the three stop-time rules — hold notify/release and issue citation (reads the Stop payload on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `pretool:guard` above: this runs at every
		// turn end, so it must stay eligible for in-process dispatch rather than pay a second tsx start.
		// It loads `.env` through the shared `hook-decision.ts` loader.
	},
	'session:lang': {
		script: 'scripts/josh/session-language-cli.ts',
		description:
			'Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, and the run:board reply rule while a backlogrun is live (otherwise nothing)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `batch:guard` above: this runs on every
		// `UserPromptSubmit`, so it must stay eligible for in-process dispatch rather than pay a second
		// tsx start each turn. It calls `process.loadEnvFile` itself through the shared loader.
	},
	'codex:hook-adapter': {
		script: 'scripts/hooks/codex-hook-adapter.ts',
		description:
			'Codex hook: run the pretool or posttool guard on a Codex payload (reads the tool call on stdin)',
		category: 'Development',
		reference: ['<pretool|posttool>', 'automation', ['none']],
		// The live-source fallback `scripts/hooks/run-hook.sh` derives from the `codex-hook-adapter`
		// bundle name. **No `tsx_arguments`**, the same as `pretool:guard`
		// above: it runs before every guarded Codex call.
	},
	'cspell:dot': {
		script: 'scripts/lint/cspell-cached.ts',
		description: 'Run spell check including dotfiles',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		core_weight: core_budget.CORE_WEIGHTS.spell_check,
		memory_mb: core_budget.MEMORY_MB.spell_check,
	},
	behavior: {
		script: 'scripts/behavior/behavior-cli.ts',
		description:
			"Check the current run's recorded transcript against the behavior assertions (no model call)",
		category: 'Development',
		reference: ['', 'developer', ['files']],
	},
	'exports:unused': {
		script: 'scripts/exports/unused-members-cli.ts',
		description:
			'Report exported namespace members nothing reads (kit only; a consumer project skips it)',
		category: 'Development',
		reference: ['', 'developer', ['none']],
	},
	'test:unit': {
		script: 'scripts/test/test-unit-guard.ts',
		description:
			'Run unit tests with Vitest (skips when Vitest is absent; fails when it has no tests)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
		core_weight: gate_plan.direct_unit_weight,
		memory_mb: gate_plan.direct_unit_memory,
	},
	'test:related': {
		script: 'scripts/test/test-related.ts',
		description: 'Run only the unit tests related to the changed files (full suite on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
		core_weight: gate_plan.direct_unit_weight,
		memory_mb: gate_plan.direct_unit_memory,
	},
	'test:declared': {
		script: 'scripts/test/test-declared.ts',
		description:
			'Report whether the working-tree change needs a test (required/exempt/satisfied); --match checks Step 0 declarations on stdin',
		category: 'Development',
		reference: [MATCH_ARGUMENTS, 'developer', ['processes']],
	},
	'test:red': {
		script: 'scripts/test/test-red.ts',
		description:
			'Run the changed unit tests against the pre-fix tree (merge-base worktree) and report red/green/no-test/test-only',
		category: 'Development',
		reference: ['', 'developer', ['git', 'processes']],
	},
	disposition: {
		script: 'scripts/review/disposition-cli.ts',
		description:
			'Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime)',
		category: 'AI tools',
		reference: [PATH_ARGUMENTS, 'automation', ['none']],
	},
	'e2e:retry-check': {
		script: 'scripts/test/e2e-retry-check.ts',
		description: 'Report whether the preview server crashed during a failed E2E attempt (CI)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
	},
	'test:e2e': {
		script: 'scripts/test/test-e2e-guard.ts',
		description: 'Run E2E tests with Playwright (skips when absent or no e2e files)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
	},
	test: {
		shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
		description: 'Run unit and E2E tests',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		argument_targets: ['test:unit', 'test:e2e'],
	},
	check: {
		script: 'scripts/gate/type-check-command.ts',
		description: 'Type-check with tsc (skips a basic project with no TypeScript to check)',
		category: 'Development',
		reference: ['[arguments...]', 'developer', ['processes']],
		core_weight: core_budget.CORE_WEIGHTS.type_check,
		memory_mb: core_budget.MEMORY_MB.type_check,
	},
	port: {
		script: 'scripts/ports/port-command.ts',
		description: 'Print the PORT_SEED-resolved dev or preview port',
		category: 'Development',
		reference: ['<dev|preview>', 'developer', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEV_COMMANDS }
