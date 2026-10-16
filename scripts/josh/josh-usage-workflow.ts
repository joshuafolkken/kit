import type { CommandUsage } from './josh-command-types'

// The usage of the commands `docs/josh-commands-automation.md` documents under "Workflow",
// "Versioning", "Maintenance" and "Git hooks", keyed by command name. The page's usage blocks are
// generated from this table and `josh help <command>` prints it, so an example or a flag is written
// once, here (#3939).
const PR_TITLE = '"PR title #N"'
const ISSUE_URL = '--issue-url "https://..."'
const REVIEW_ISSUE = '--issue 2325'
const CHECK = '--check'
const JSON_FLAG = '--json'
const BODY_FILE_NOTE =
	'(`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.'

/* eslint-disable @typescript-eslint/naming-convention */
const WORKFLOW_USAGE: Readonly<Record<string, CommandUsage>> = {
	followup: {
		examples: [
			{ arguments: PR_TITLE, note: 'merges (default)' },
			{ arguments: String.raw`${PR_TITLE} --notify-message "Implemented X:\n- change 1"` },
			{ arguments: `${PR_TITLE} --notify-message-file completion.md` },
			{ arguments: `${PR_TITLE} --ai-review-ignore-reason "false positive"` },
			{ arguments: `${PR_TITLE} --no-merge`, note: 'do the work, leave the PR open' },
		],
		flags: [
			{
				names: ['--no-merge'],
				description:
					'do the follow-up work but do not merge; leaves the PR open (the only flag that stops the merge). `--merge` is a deprecated no-op. A PR already merged by hand skips the CI wait, the AI-review scan and the merge and runs only the post-merge tail; a completion report already on the Issue is not posted again.',
			},
			{
				names: ['--notify-message'],
				description: 'inline completion body; `\\n` expands to newlines.',
			},
			{
				names: ['--notify-message-file'],
				description: `read the completion body from a file ${BODY_FILE_NOTE}`,
			},
			{
				names: ['--ai-review-ignore-reason'],
				description: 'reason to dismiss an AI-review finding.',
			},
		],
	},
	notify: {
		examples: [
			{ arguments: String.raw`--task-type planning ${ISSUE_URL} --body="- bullet 1\n- bullet 2"` },
			{
				arguments: `--task-type confirmation ${ISSUE_URL} --body-file r.md --recommended "Go" --alternative "Wait"`,
			},
		],
		flags: [
			{
				names: ['--task-type'],
				description:
					'one of `planning` 📋, `completion` ✅, `failure` ❌, `warning` ⚠️, `kickoff_retry` 🔄, `confirmation` ⏸️. Do not send `completion` or `warning` by hand — `josh followup` sends them.',
			},
			{
				names: ['--body', "--body=$'…'"],
				description: "inline body; use `--body=$'…'` when it starts with `-`.",
			},
			{ names: ['--body-file'], description: `read the body from a file ${BODY_FILE_NOTE}` },
			{
				names: ['--repo-name', '--issue-url', '--pr-url'],
				description:
					'header repository, resolved in that order, then the working directory. The issue title is read from `--issue-url`.',
			},
			{
				names: ['--recommended', '--alternative'],
				description:
					'the choices appended under `JOSH_SESSION_LANG` headings; `--recommended` is required for `confirmation`, `--alternative` is repeatable.',
			},
		],
	},
	'observations:flush': { examples: [{ arguments: '' }] },
	'measure:rerun': { examples: [{ arguments: '2212' }] },
	'review:record': {
		examples: [
			{ arguments: `${REVIEW_ISSUE} bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts` },
			{ arguments: REVIEW_ISSUE, note: 'a zero-finding round — records one `none` line' },
			{
				arguments: `${REVIEW_ISSUE} --comment`,
				note: 'a round that passed after the PR opened — an Issue comment, no append',
			},
			{ arguments: `${CHECK} ${REVIEW_ISSUE}`, note: 'the merge gate: was it recorded?' },
		],
	},
	bump: { examples: [{ arguments: 'major' }, { arguments: 'minor' }, { arguments: 'patch' }] },
	release: {
		examples: [
			{ arguments: '' },
			{ arguments: '--dry-run', note: 'count and report, write nothing' },
		],
		flags: [
			{
				names: ['--dry-run'],
				description:
					'count and report only; writes nothing, fetches nothing, and creates no work tree.',
			},
			{
				names: ['--help', '-h'],
				description:
					'print the usage line and exit 0 without fetching or releasing. Any other argument is refused with the usage line and a non-zero exit, before anything is fetched.',
			},
		],
	},
	'release:scope': {
		examples: [
			{ arguments: '', note: '→ required | skip | unknown' },
			{ arguments: '--json', note: '{"scope":"…","reason":"…"} on one line' },
		],
	},
	'ruleset:check': {
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
	'audit:provision': {
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
	'reconcile-templates': {
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
	'pre-push-unit': { examples: [{ arguments: '' }] },
	'reserved-run': {
		examples: [
			{ arguments: '2 -- pnpm install', note: 'hold 2 cores while installing' },
			{ arguments: '1 -- pnpm josh audit', note: 'hold 1 core while scanning' },
		],
	},
	'pre-commit-type-check': { examples: [{ arguments: '' }] },
	'pr:classification': {
		examples: [{ arguments: '', note: 'run by CI on a pull request; fails without one label' }],
	},
	'observation:record': {
		examples: [
			{ arguments: "flaky-e2e d1 'tests/e2e/login.test.ts' 'times out on CI only'" },
			{
				arguments: "flaky-e2e d1 'src/app.ts' 'fails there too' --checkout ~/Development/app",
				note: "another repository's ledger",
			},
		],
		flags: [
			{
				names: ['--checkout <path>'],
				description: "count and append in that repository's `.josh/observations/` instead.",
			},
		],
	},
	'release:github': {
		examples: [
			{ arguments: '', note: 'run by CI with GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY set' },
		],
	},
	'latest:scope': {
		examples: [
			{ arguments: '', note: 'required or skip, the reason on stderr' },
			{ arguments: '--record', note: 'note a finished josh latest run' },
			{ arguments: JSON_FLAG, note: 'the verdict and the reason as JSON' },
		],
		flags: [
			{ names: ['--record'], description: 'write the completion record `josh latest` ends with.' },
			{ names: [JSON_FLAG], description: 'emit the verdict and its reason as JSON.' },
		],
	},
	'latest:guard': { examples: [{ arguments: '', note: 'refuses inside a lane' }] },
	'prevent-main-commit': { examples: [{ arguments: '', note: 'run by the pre-commit hook' }] },
	'check-commit-message': {
		examples: [{ arguments: '.git/COMMIT_EDITMSG', note: 'run by the commit-msg hook' }],
	},
	'secretlint-scan': {
		examples: [{ arguments: 'src/app.ts .env.example', note: 'the staged paths' }],
	},
	'pre-commit-lint': {
		examples: [
			{ arguments: 'cspell src/app.ts' },
			{ arguments: 'prettier src/app.ts' },
			{ arguments: 'eslint src/app.ts' },
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_USAGE }
