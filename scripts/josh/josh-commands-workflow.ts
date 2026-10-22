import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const PR_TITLE = '"PR title #N"'
const BODY_FILE_NOTE =
	'(`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.'
const ISSUE_URL = '--issue-url "https://..."'
const REVIEW_ISSUE = '--issue 2325'
const CHECK = '--check'
const YES = '-y'
const SKIP_COMMIT = '--skip-commit'
const SKIP_PUSH = '--skip-push'

const GIT_WORKFLOW_SCRIPT = 'scripts/git/git-workflow.ts'
const GIT_MESSAGE_ARGUMENTS = '[-y] <message>'

/* eslint-disable @typescript-eslint/naming-convention */
const WORKFLOW_COMMANDS: Record<string, CommandEntry> = {
	git: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Git workflow helper',
		category: 'Workflow',
		reference: [GIT_MESSAGE_ARGUMENTS, 'developer', ['git', 'network']],
		usage: {
			examples: [
				{ arguments: '', note: 'interactive' },
				{ arguments: YES, note: 'unattended (no TTY required)' },
				{ arguments: '-y "title"', note: 'set commit message prefix' },
				{ arguments: '-y "<title> #<N>"', note: 'follow-up commit on the same branch' },
				{
					arguments: '-y --skip-commit --skip-push',
					note: 'open the PR without committing/pushing',
				},
			],
			flags: [
				{
					names: [YES, '--yes'],
					description: 'run non-interactively; works without a TTY (agent or CI shell).',
				},
				{
					names: [SKIP_COMMIT, SKIP_PUSH],
					description: 'recover/open a PR without a new commit or push.',
				},
			],
		},
	},
	pr: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Create PR only (skip commit and push)',
		category: 'Workflow',
		// Not `GIT_MESSAGE_ARGUMENTS`: `-y` is already in the default arguments below, so advertising
		// it would document a flag that cannot change what this command does.
		reference: ['<message>', 'developer', ['network']],
		default_script_arguments: [YES, SKIP_COMMIT, SKIP_PUSH],
		usage: { examples: [{ arguments: '', note: 'open the PR for the current <N>-<slug> branch' }] },
	},
	// **The optional form, on both**. The mandatory `--env-file=.env` is resolved by node before the
	// script's first line: on a machine with no `.env` it dies as `.env: not found` with exit code 9,
	// even where `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` exist as real environment variables — a
	// cloud session, and `followup` with them the merge step of every `fullrun` there.
	//
	// Nothing is lost by relaxing it: both scripts already load `.env` through `josh_environment_file`
	// themselves, so the file is read either way and node's precedence — an existing environment
	// variable wins over the file — is node's own in both spellings.
	//
	// **A missing credential still fails loudly**: `telegram_notify.send` throws on missing credentials
	// and on a failed send, so `josh notify` exits non-zero instead of warning and answering 0.
	followup: {
		script: 'scripts/followup/git-followup-workflow.ts',
		description: 'Follow-up git workflow',
		category: 'Workflow',
		reference: [
			'<title> [--notify-message <text>]',
			'automation',
			['git', 'network', 'notifications'],
		],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
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
	},
	notify: {
		script: 'scripts/notify/telegram-test-main.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		reference: [
			'[--task-type <type>] [--body <text> | --body-file <path>] [--issue-url <url>] [--pr-url <url>] [--issue-title <text>] [--repo-name <name>] [--recommended <text>] [--alternative <text>]...',
			'automation',
			['notifications'],
		],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
			examples: [
				{
					arguments: String.raw`--task-type planning ${ISSUE_URL} --body="- bullet 1\n- bullet 2"`,
				},
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
	},
	// One observation-ledger sighting: the key's count, the append and the second-sighting verdict,
	// which a run used to type as a `cat | grep -c` and judge by hand.
	'observation:record': {
		script: 'scripts/observations/observation-record-cli.ts',
		description: 'Record an observation sighting and answer whether it is now filed',
		category: 'Workflow',
		reference: ['<key> <depth> <where> <what> [--checkout <path>]', 'automation', ['files']],
		usage: {
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
	},
	// The observation ledger's commit path for the lines no run's own commit carried:
	// a lane's lines sit in the primary checkout, which
	// its commit cannot see, and the recurrence count the promotion rule reads is a count of main.
	'observations:flush': {
		script: 'scripts/observations/observations-flush-cli.ts',
		description: 'Commit the observation ledger as a pull request of its own, and merge it',
		category: 'Workflow',
		reference: ['', 'automation', ['git', 'network']],
		usage: { examples: [{ arguments: '' }] },
	},
	// The one write path for a `/code-review` round's findings, plus the
	// `--check` gate `followup` runs before it merges. It appends a `- rf:`
	// line per finding — or one zero-finding line for a clean round — to the observation ledger, so
	// `observations:flush` commits them and the recurrence count survives the run.
	'review:record': {
		script: 'scripts/review/review-record-main.ts',
		description: 'Record a review round’s findings, or check a round was recorded',
		category: 'Workflow',
		reference: [
			'--issue <N> [--comment] [<category>:<severity>:<file> ...] | --check --issue <N>',
			'automation',
			['files', 'network'],
		],
		usage: {
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
	},
	// The reader over what `review:record` wrote: each recurring category’s
	// count, and the number of zero-finding rounds that distinguishes a quiet category from an unwatched one.
	'review:findings': {
		script: 'scripts/review/review-findings-cli.ts',
		description: 'Count review findings by category from the observation ledger',
		category: 'Workflow',
		reference: ['', 'developer', ['files']],
		usage: { examples: [{ arguments: '' }] },
	},
	// After a behavior-change Issue merges, re-run its declared baseline and print before/after; a value
	// that did not move appends a refuted-premise line to the observation ledger.
	'measure:rerun': {
		script: 'scripts/issue/measure-rerun-cli.ts',
		description: 'Re-run a merged issue’s baseline command and print the before/after pair',
		category: 'Workflow',
		reference: ['<issue-number>', 'automation', ['network', 'processes', 'files']],
		usage: { examples: [{ arguments: '2212' }] },
	},
	// A script rather than an `sh -c` chain, because it has a precondition to enforce: run inside a
	// linked work tree it would hijack the default branch from every other one.
	'main:sync': {
		script: 'scripts/git/main-sync-main.ts',
		description:
			'Checkout default branch, pull latest, and prune merged remote-gone branches (refuses inside a lane)',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
		usage: { examples: [{ arguments: '' }] },
	},
	// A script rather than an `sh -c` chain, because the strategy has to be named rather than left to
	// the caller's git configuration: a bare `git pull` aborts with `Need to specify how to reconcile
	// divergent branches` on exactly the diverged branch the command exists for.
	//
	// **It declares no core weight, by measurement** (joshuafolkken/kit#3944): its own work is git, and
	// the catalog it may regenerate took 0.6s of CPU. The heavy processes seen beside it are commit
	// hooks — its regenerated catalog's commit runs them — which reserve themselves, and a weight here
	// would set the held mark they inherit, folding the parallel hook tools into this one place.
	'main:merge': {
		script: 'scripts/git/main-merge-main.ts',
		description: 'Merge origin default branch into the current branch',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
		usage: { examples: [{ arguments: '' }] },
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_COMMANDS }
