import type { CommandUsage } from './josh-command-types'

// The usage of the commands `docs/josh-commands-automation.md` documents under "Development",
// "Project" and "AI tools", keyed by command name. The page's usage blocks are generated from this
// table and `josh help <command>` prints it, so an example or a flag is written once, here (#3939).
const STAGED = '--staged'
const JSON_FLAG = '--json'
const BRANCH_DIFF = 'the branch diff'
const STAGED_DIFF = 'the staged diff instead'
const PR_NUMBER = '42'
const DRY_RUN = '--dry-run'
const SKIP_PUBLISH_WAIT = '--skip-publish-wait'

/* eslint-disable @typescript-eslint/naming-convention */
const AUTOMATION_USAGE: Readonly<Record<string, CommandUsage>> = {
	'refactor:scan': { examples: [{ arguments: '' }] },
	'time:density': {
		examples: [{ arguments: '' }, { arguments: '--lanes 5', note: 'the five most recent lanes' }],
		flags: [
			{
				names: ['--lanes <n>'],
				description: 'average over a different count of recent qualifying lanes (default 10).',
			},
			{
				names: ['--path <dir>'],
				description:
					"read another project's lane transcripts, as `josh time` does. Run it from the main checkout — a lane reads only its own transcript.",
			},
		],
	},
	'e2e:retry-check': { examples: [{ arguments: '' }] },
	'sync:scope': {
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
	'dogfood:commit': { examples: [{ arguments: '~/Development/kit-test-html-start' }] },
	'fresh:run': {
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
				description: 'where the log is written. Default: `.claude/tmp/fresh-machine`.',
			},
			{ names: ['--rebuild'], description: 'build the machine image without the layer cache.' },
		],
	},
	'auth:setup': {
		examples: [
			{ arguments: '', note: 'sign in and save the token' },
			{ arguments: '--check', note: 'ok: … saved on <date>, or missing: … and exit 1' },
		],
	},
	'sonar:hotspots': { examples: [{ arguments: PR_NUMBER }] },
	'sonar:new-code': { examples: [{ arguments: PR_NUMBER }] },
	'ui:routes': {
		examples: [
			{ arguments: '', note: BRANCH_DIFF },
			{ arguments: STAGED, note: STAGED_DIFF },
		],
	},
	propagate: {
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
	'repo:party': {
		examples: [
			{ arguments: 'joshuafolkken/kit', note: '→ first-party (in the kit session)' },
			{ arguments: 'sveltejs/kit', note: '→ third-party' },
			{ arguments: '', note: "no argument: the session's own repository" },
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AUTOMATION_USAGE }
