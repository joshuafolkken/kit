import type { CommandEntry } from './josh-command-types'

const STAGED = '--staged'
const JSON_FLAG = '--json'
const BRANCH_DIFF = 'the branch diff'
const STAGED_DIFF = 'the staged diff instead'
const PR_NUMBER = '42'
const DRY_RUN = '--dry-run'
const SKIP_PUBLISH_WAIT = '--skip-publish-wait'

// Command names are the CLI's, not TypeScript's: a scoped one carries a colon (`sync:scope`), which
// no identifier format allows. The same disable sits at the top of `josh-commands-maintenance.ts`
// for the same reason.
/* eslint-disable @typescript-eslint/naming-convention */
const PROFILE_ARGUMENTS = '[--profile basic|full]'
const PROJECT_COMMANDS: Record<string, CommandEntry> = {
	profile: {
		script: 'scripts/init/project-profile-cli.ts',
		description: 'Show the project profile and the reason for it',
		category: 'Project',
		reference: [PROFILE_ARGUMENTS, 'developer', ['files']],
		usage: { examples: [{ arguments: '' }] },
	},
	start: {
		script: 'scripts/init/start.ts',
		description: 'Set a project up for the GitHub Issue workflow, from git init to the setup PR',
		category: 'Project',
		reference: [
			`${PROFILE_ARGUMENTS} [--yes] [--github] [--public] [--dry-run] [--init-command <command>] [--push-preflight-command <command>]`,
			'developer',
			['files', 'git', 'network', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'asks for the profile and the repository' },
				{
					arguments: '--yes --github --profile basic',
					note: 'unattended, including the GitHub repository',
				},
			],
			flags: [
				{ names: ['--profile basic|full'], description: 'the profile, without asking.' },
				{ names: ['--yes'], description: 'take the defaults — not consent to write to GitHub.' },
				{ names: ['--github'], description: 'create the GitHub repository and push `main`.' },
				{ names: ['--public'], description: 'create the repository public instead of private.' },
				{
					names: ['--init-command "<command>"'],
					description: 'run this setup command in place of `josh init`.',
				},
				{
					names: ['--push-preflight-command "<command>"'],
					description:
						'a check run before the first step when the plan pushes; a failure stops the run before it writes anything.',
				},
				{ names: ['--dry-run'], description: 'print the plan and change nothing.' },
			],
		},
	},
	'dogfood:commit': {
		script: 'tools/dogfood/dogfood-commit-cli.ts',
		description: "Make the first commit of a dogfood run's own kit-test-* project",
		category: 'Project',
		reference: ['<dir>', 'automation', ['files', 'git']],
		is_kit_only: true,
		usage: { examples: [{ arguments: '~/Development/kit-test-html-start' }] },
	},
	'fresh:run': {
		script: 'scripts/fresh-machine/fresh-machine-cli.ts',
		description:
			'Run an install scenario in a Docker container of a machine with nothing installed, and keep the log',
		category: 'Project',
		reference: [
			'<pattern> | --spec <file.json> [--package-version <version>] [--log-dir <dir>] [--rebuild] | --list',
			'maintainer',
			['files', 'network', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: '--list', note: "kit's six patterns" },
				{ arguments: 'kit-test-html-init', note: 'one pattern, the packed checkout' },
				{
					arguments: 'kit-test-html-start',
					note: 'a GitHub pattern, the latest published version',
				},
				{ arguments: '--spec fresh/html-init.json', note: 'a scenario another toolkit wrote' },
			],
			flags: [
				{ names: ['--list'], description: 'print the pattern names and run nothing.' },
				{
					names: ['--spec <file.json>'],
					description:
						'run the scenario in this file instead of a named pattern; the path is relative to the project root.',
				},
				{
					names: ['--package-version <version>'],
					description:
						"the published version a `package_source: published` scenario installs. Default: the registry's latest version of the package the command is run from.",
				},
				{
					names: ['--log-dir <dir>'],
					description: 'where the log is written. Default: `.josh/tmp/fresh-machine`.',
				},
				{ names: ['--rebuild'], description: 'build the machine image without the layer cache.' },
			],
		},
	},
	'auth:setup': {
		script: 'scripts/auth/auth-setup-cli.ts',
		description:
			'Save the long-lived Claude Code token `claude setup-token` prints in the macOS keychain, for josh fresh:run',
		category: 'Project',
		reference: ['[--check]', 'maintainer', ['network', 'processes']],
		usage: {
			examples: [
				{ arguments: '', note: 'sign in and save the token' },
				{ arguments: '--check', note: 'ok: … saved on <date>, or missing: … and exit 1' },
			],
		},
	},
	init: {
		script: 'scripts/init/init-main.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
		reference: [
			`${PROFILE_ARGUMENTS} [--no-install] [--dry-run]`,
			'developer',
			['files', 'network', 'processes'],
		],
		usage: {
			examples: [
				{
					arguments: '',
					note: 'create/merge config files, install and format (--no-install skips both, --dry-run only prints the plan)',
				},
			],
		},
	},
	sync: {
		script: 'scripts/sync/sync-main.ts',
		description: 'Sync config files',
		category: 'Project',
		reference: ['', 'developer', ['files']],
		usage: { examples: [{ arguments: '', note: 'overwrite managed files' }] },
	},
	uninstall: {
		script: 'scripts/uninstall/uninstall.ts',
		description: 'Remove what kit added to a project and list what is left to review by hand',
		category: 'Project',
		reference: [`${PROFILE_ARGUMENTS} [--yes]`, 'developer', ['files', 'processes']],
		usage: {
			examples: [
				{ arguments: '', note: 'show the plan, then ask' },
				{ arguments: '--yes', note: 'remove without asking' },
			],
		},
	},
	'sync:scope': {
		script: 'scripts/sync/managed-config-scope-cli.ts',
		description: 'Say whether this change touches a file josh sync distributes',
		category: 'Project',
		reference: ['[--staged] [--json]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: BRANCH_DIFF },
				{ arguments: STAGED, note: STAGED_DIFF },
				{ arguments: JSON_FLAG, note: '{"scope":"managed","reason":"..."}' },
			],
			flags: [
				{ names: [STAGED], description: 'inspect the staged diff instead of the branch diff.' },
				{ names: [JSON_FLAG], description: 'emit `{"scope","reason"}` as JSON.' },
			],
		},
	},
	'sonar:hotspots': {
		script: 'scripts/sonar/sonar-hotspots-cli.ts',
		description:
			"Fetch SonarCloud hotspots on a pull request and print each one's Step B disposition",
		category: 'Project',
		reference: ['<PR>', 'automation', ['network']],
		usage: { examples: [{ arguments: PR_NUMBER }] },
	},
	'sonar:new-code': {
		script: 'scripts/sonar/sonar-new-code-cli.ts',
		description: 'Fail when a pull request adds any new SonarCloud issue or duplicated block',
		category: 'Project',
		reference: ['<PR>', 'automation', ['network']],
		usage: { examples: [{ arguments: PR_NUMBER }] },
	},
	'ui:routes': {
		script: 'scripts/ui/ui-routes-cli.ts',
		description: 'List the screenshot-target routes the current change touches',
		category: 'Project',
		reference: ['[--staged]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: BRANCH_DIFF },
				{ arguments: STAGED, note: STAGED_DIFF },
			],
		},
	},
	propagate: {
		script: 'scripts/propagate/propagate.ts',
		description: 'Carry the published release into every consumer repository next to this one',
		category: 'Project',
		reference: [
			'[--dry-run] [--skip-publish-wait] [--target <repo>]',
			'maintainer',
			['files', 'network'],
		],
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: DRY_RUN, note: 'report targets and steps, write nothing' },
				{ arguments: SKIP_PUBLISH_WAIT, note: 'release already known to be published' },
				{ arguments: '--target app-kit', note: 'carry the release into one consumer only' },
			],
			flags: [
				{
					names: [DRY_RUN],
					description:
						'report targets and steps without writing; skips the publish wait, opens no issues.',
				},
				{
					names: [SKIP_PUBLISH_WAIT],
					description: 'skip the registry poll for an already-published release.',
				},
				{
					names: ['--target <repo>'],
					description:
						'process only that consumer (`app-kit` or `joshuafolkken/app-kit`); the rest are reported `skipped` and left untouched. An unknown, ambiguous or non-dependent name fails before the publish wait, writing nothing.',
				},
			],
		},
	},
	adopt: {
		script: 'scripts/adopt/adopt.ts',
		description: 'Upgrade the @joshuafolkken toolkits and other dependencies here, open the PR',
		category: 'Project',
		reference: ['[--dry-run]', 'developer', ['files', 'git', 'network', 'processes']],
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: '--dry-run', note: 'report the steps without touching anything' },
			],
			flags: [{ names: ['--dry-run'], description: 'report the plan without writing.' }],
		},
	},
}

export { PROJECT_COMMANDS }
