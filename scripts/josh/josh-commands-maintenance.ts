import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const CHECK = '--check'
const JSON_FLAG = '--json'

/* eslint-disable @typescript-eslint/naming-convention */
const MAINTENANCE_COMMANDS: Record<string, CommandEntry> = {
	doctor: {
		script: 'scripts/doctor/doctor.ts',
		description:
			'Diagnose PATH shadowing of the global josh and show the discovered repository map (--fix reclaims a stale shim)',
		category: 'Maintenance',
		reference: ['[--fix]', 'developer', ['files']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
			examples: [
				{ arguments: '', note: 'diagnose only' },
				{ arguments: '--fix', note: 'reclaim the global josh by removing a stale kit shim' },
				{ arguments: '--ports', note: 'also print the per-repository port-seed table' },
			],
			flags: [
				{
					names: ['--fix'],
					description:
						'remove a shadowing binary **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script); any other binary is left and reported for manual review. Also the one-shot recovery for an old project that re-created the global shim.',
				},
				{ names: ['--ports'], description: 'additionally print the port-seed table (see below).' },
			],
		},
	},
	'ruleset:check': {
		script: 'scripts/repo/ruleset-check-cli.ts',
		description:
			"Check that the default branch requires every status check kit's workflows report (--apply adds the missing ones)",
		category: 'Maintenance',
		reference: ['[--apply]', 'maintainer', ['network']],
		usage: {
			examples: [
				{ arguments: '', note: 'report only' },
				{ arguments: '--apply', note: 'add the missing checks to the existing rule' },
			],
			flags: [
				{
					names: ['--apply'],
					description:
						"append the missing checks to the ruleset's required-checks rule (or to the branch protection's contexts). It never creates a ruleset: with none, create one under Settings → Rules → Rulesets, then rerun. Writing a repository setting needs admin access, so only this flag writes — `josh sync` and `josh doctor` never do.",
				},
			],
		},
	},
	overrides: {
		script: 'scripts/overrides/overrides-check.ts',
		description: 'Check pnpm overrides for drift',
		category: 'Maintenance',
		reference: ['[--save]', 'developer', ['files']],
		usage: {
			examples: [
				{ arguments: '', note: 'verify overrides unchanged' },
				{ arguments: '--save', note: 'snapshot current merged overrides' },
			],
			flags: [
				{
					names: ['--save'],
					description:
						'write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.',
				},
			],
		},
	},
	audit: {
		script: 'scripts/security/security-audit-main.ts',
		description: 'Run security audit',
		category: 'Maintenance',
		reference: ['', 'developer', ['processes']],
		usage: { examples: [{ arguments: '' }] },
	},
	'lockfile:policy': {
		script: 'tools/security/lockfile-policy.ts',
		description:
			"Verify the lockfile against pnpm's supply-chain policy (minimumReleaseAge) when it or the policy moved from the merge-base",
		category: 'Maintenance',
		reference: ['', 'automation', ['network']],
		is_kit_only: true,
		usage: {
			examples: [{ arguments: '', note: 'verify when the lockfile or its policy moved' }],
		},
	},
	'ci:timing': {
		script: 'scripts/ci/ci-timing-cli.ts',
		description:
			"Print the job and step durations and conclusions of a run id's GitHub Actions run, or of every run on a pull request's or a branch's latest commit",
		category: 'Maintenance',
		reference: ['<pr|branch|run-id> [--json]', 'developer', ['network']],
		usage: {
			examples: [
				{ arguments: '5544', note: 'a pull request, or a branch name' },
				{ arguments: '18912345678 --json', note: 'a run id, machine-readable' },
			],
		},
	},
	'command:derive': {
		script: 'tools/document/command-derive.ts',
		description:
			'Write every artifact the command map derives — usage spans, catalog, snapshot — and print page bytes against their ceilings',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files']],
		// Kit-only: the pages it writes are kit's own documentation, and the script lives under the
		// undistributed `tools/`.
		is_kit_only: true,
		// The command-map snapshot runs through one single-file vitest run.
		core_weight: 1,
		usage: {
			examples: [{ arguments: '', note: 'after adding, renaming or describing a command' }],
		},
	},
	'audit:provision': {
		script: 'scripts/security/security-audit-provision-main.ts',
		description: 'Install the pinned osv-scanner when the audit cannot find one (no-op if present)',
		category: 'Maintenance',
		reference: ['', 'automation', ['files', 'network']],
		usage: {
			examples: [
				{ arguments: '', note: 'no-op if a scanner is already present' },
				{ arguments: '--force', note: 'ignore backoff, allow a longer download' },
			],
			flags: [
				{
					names: ['--force'],
					description:
						'ignore the 6-hour failure backoff and allow a longer download window; the command to run after fixing a network problem.',
				},
			],
		},
	},
	'reconcile-templates': {
		script: 'scripts/sync/reconcile-templates.ts',
		description: 'Record template source hashes (--check to verify drift)',
		category: 'Maintenance',
		reference: ['', 'maintainer', ['files']],
		usage: {
			examples: [
				{ arguments: '', note: 'regenerate copy templates + record tripwire hashes' },
				{ arguments: CHECK, note: 'verify templates are in sync; non-zero on drift' },
			],
			flags: [
				{
					names: [CHECK],
					description:
						'verify only; exits non-zero on drift. A pre-commit hook runs this when a tracked source or copy template is staged.',
				},
			],
		},
	},
	latest: {
		shell: [
			'sh',
			'-c',
			'export NODE_AUTH_TOKEN=$(gh auth token) && pnpm josh latest:guard && pnpm josh latest:update && pnpm josh ranges && pnpm josh audit && pnpm josh latest:corepack && pnpm josh latest:scope --record',
		],
		description: 'Update dependencies, run security audit, then update pnpm',
		category: 'Maintenance',
		reference: ['', 'developer', ['files', 'network', 'processes']],
		argument_targets: ['latest:corepack', 'latest:update', 'audit'],
		usage: { examples: [{ arguments: '', note: 'full update (update + audit + pnpm)' }] },
	},
	'latest:scope': {
		script: 'scripts/version/latest-scope-main.ts',
		description:
			'Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run)',
		category: 'Maintenance',
		reference: ['[--record] [--json]', 'automation', ['files']],
		// `JOSH_LATEST_MAX_AGE_HOURS` is documented as a project setting, so it has to be readable
		// where the project keeps its settings — a variable that only works when exported from the
		// shell is one a user follows the documentation for and gets the default from, silently.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
			examples: [
				{ arguments: '', note: 'required or skip, the reason on stderr' },
				{ arguments: '--record', note: 'note a finished josh latest run' },
				{ arguments: JSON_FLAG, note: 'the verdict and the reason as JSON' },
			],
			flags: [
				{
					names: ['--record'],
					description: 'write the completion record `josh latest` ends with.',
				},
				{ names: [JSON_FLAG], description: 'emit the verdict and its reason as JSON.' },
			],
		},
	},
	'latest:if-required': {
		script: 'scripts/version/latest-if-required-cli.ts',
		description: 'Run josh latest only when latest:scope answers required, stashing around it',
		category: 'Maintenance',
		reference: ['', 'automation', ['files', 'network', 'processes']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: { examples: [{ arguments: '', note: 'stash, update, pop on required' }] },
	},
	'latest:guard': {
		script: 'scripts/version/latest-lane-guard-main.ts',
		description: 'Refuse josh latest inside a lane (the update stamp is keyed to the project root)',
		category: 'Maintenance',
		reference: ['', 'automation', ['files']],
		usage: { examples: [{ arguments: '', note: 'refuses inside a lane' }] },
	},
	'latest:corepack': {
		script: 'scripts/version/latest-corepack.ts',
		description: 'Update pnpm on the current major while preserving the integrity pin',
		category: 'Maintenance',
		reference: ['', 'developer', ['files', 'network']],
		usage: { examples: [{ arguments: '', note: 'update pnpm only' }] },
	},
	'latest:update': {
		script: 'scripts/version/latest-update.ts',
		description: 'Update all dependencies to latest',
		category: 'Maintenance',
		reference: ['', 'developer', ['files', 'network']],
		// `JOSH_PLAYWRIGHT_BROWSERS` widens the browsers a Playwright bump installs, and a project
		// keeps that setting in its `.env`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: { examples: [{ arguments: '', note: 'update dependencies only' }] },
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { MAINTENANCE_COMMANDS }
