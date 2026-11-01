import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const OUTPUT = '--output <path>'
const OWNER = '--owner <pid>'
const ISSUE_WITH_OPTIONS = '<issue> [options]'

// The merge, review-launch, tail and ship commands, split out of `josh-commands-ai.ts` when each
// command's usage moved onto its entry (#4185). `AI_COMMANDS` spreads this in at the same place, so the
// map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
const SHIP_COMMANDS: Record<string, CommandEntry> = {
	'run:merge': {
		script: 'scripts/run/merge/run-merge-main.ts',
		description:
			'Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['git', 'network']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
			examples: [
				{
					arguments: '<N> --epic <E> --repo <owner/repo> --output <path>',
					note: 'prints the next child number, or a verdict',
				},
				{ arguments: '<N>', note: 'backlog offer (no epic)' },
			],
			flags: [
				{
					names: ['--epic <E>', '--repo <owner/repo>'],
					description: "offer the epic's next children; omit both for the opted-in backlog.",
				},
				{
					names: [OWNER],
					description:
						"the parent's process, so the carry count respects the ownership guard; omitted, the calling session.",
				},
				{
					names: [OUTPUT],
					description:
						'the transcript the outage and usage-limit splits read; absent, they are off.',
				},
				{
					names: ['--driver'],
					description:
						'the caller is `backlog:drive`, which has no context to cut and asks `backlog:offer` itself, so the merge is never handed back `over` and answers `deferred` in place of the next offer.',
				},
			],
		},
	},
	'run:review': {
		script: 'scripts/run/review/run-review-cli.ts',
		description:
			'Start test:pinned and the gate in the background and write the /code-review brief to a file, printing its path, in one call so they overlap (--join to join them; it stops on an unpinned change)',
		category: 'AI tools',
		reference: [
			'[--code-only] [--unpinned-ok "<reason>"] | --join [--fixing] | --pinned | --push',
			'automation',
			['processes', 'files', 'git', 'network'],
		],
		usage: {
			examples: [
				{
					arguments: '',
					note: 'detach test:pinned and the gate, write the brief (the interaction brief after it where due) to a file and print its path, then launch a reviewer per brief',
				},
				{
					arguments: '--code-only',
					note: "josh ship's own open: code's brief alone, since the ship opens the interaction brief itself",
				},
				{
					arguments: '--unpinned-ok "only logs"',
					note: 'check beside the pair as ever; the join prints the list and the reason and carries on past unpinned places',
				},
				{
					arguments: '--join',
					note: 'after the review returns: join the gate and test:pinned; exit 3 on an unpinned change',
				},
				{
					arguments: '--join --fixing',
					note: 'the join when round 1 has fixes to make: no grace on test:pinned, left running; prints the unpinned places the cache already holds',
				},
				{
					arguments: '--pinned',
					note: "read test:pinned alone (the ship's pre-detach reads it anyway); a lane child returns at once",
				},
				{
					arguments: '--push',
					note: 'launched by a lane open: push and open the PR at a green gate',
				},
			],
		},
	},
	// The main line's chain up to the review, folded into one call: `main:merge`, `review:selfcheck`,
	// `check:related` and `run:review` were four round trips re-billing the run's full context each.
	'run:chain': {
		script: 'scripts/run/review/run-chain-cli.ts',
		description:
			'Run main:merge (not in a lane child), review:selfcheck, check:related and run:review in one call, or with --join the half after the review (run:review --join, review:attest --check, review:record --from-slot), stopping at the first refusal with its next action',
		category: 'AI tools',
		reference: [
			'<issue> [--from <stage>] [--unpinned-ok "<reason>"] | <issue> --join [--fixing] [--from <stage>]',
			'automation',
			['processes', 'files', 'git', 'network'],
		],
		usage: {
			examples: [
				{
					arguments: '<N>',
					note: 'after `run:cut <N>` alone: merge main (not in a lane child), answer the self-check, run the scoped pair, open the review',
				},
				{
					arguments: '<N> --from check:related',
					note: 'resume at the stage a stop named, once the run settled it',
				},
				{
					arguments: '<N> --unpinned-ok "only logs"',
					note: 'forwarded to run:review as given',
				},
				{
					arguments: '<N> --join',
					note: 'once the review returns: join the gate, attest the round, record a round with no findings — a finding stops for its fix and disposition',
				},
				{
					arguments: '<N> --join --fixing',
					note: 'the same, when round 1 has fixes to make',
				},
			],
		},
	},
	// The post-merge sequence a run closed on, folded into one call: commit the
	// observation ledger, read the completion citations and decide the release scope. `observations:flush`,
	// `issue:cite` and `release:scope` were three round trips re-billing the run's full context each.
	'run:tail': {
		script: 'scripts/run/run-tail-cli.ts',
		description:
			'Close a run in one call: return to the default branch, commit the observation ledger, read the citations, decide the release scope',
		category: 'AI tools',
		reference: ['[<issue> ...]', 'automation', ['git', 'network']],
		usage: {
			examples: [
				{ arguments: '<N>', note: 'the closed issue' },
				{ arguments: '<N> <follow-up-N>', note: 'and a follow-up filed this run' },
			],
		},
	},
	// The commit-to-report region a run ships a change on, folded into one call:
	// the gate, the commit/push/PR (`git -y`), the CI-wait merge (`followup`) and the report bookkeeping
	// (`run:tail`) were four round trips re-billing the run's full context each. It stops at the first
	// failed step and names it, so the run reads only the step to fix.
	ship: {
		script: 'scripts/run/ship/run-ship-cli.ts',
		// `.env` rather than the ambient environment: parking a lane child past the relaunch cap
		// sends a Telegram warning, which needs the credentials.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Ship a change in one call: gate, commit/push/PR, the CI-wait merge and the report bookkeeping, stopping at the first failed step',
		category: 'AI tools',
		reference: [
			'"<title> #<N>" [<follow-up-N> ...] [--cite <N>] [--review [--unpinned-ok "<reason>"]] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | --log <N>',
			'automation',
			['git', 'network'],
		],
		usage: {
			examples: [
				{ arguments: '"<title> #<N>" --body-file <evidence.md>' },
				{ arguments: '"<title> #<N>" --review', note: 'both review rounds inside the ship' },
				{
					arguments: '--detach "<title> #<N>"',
					note: 'hand the ship to a supervisor; on `launched` and `cost --cut` `under`, wait one `ship:wait` chunk',
				},
				{ arguments: '--log <N>', note: "a detached ship's log" },
			],
			flags: [
				{
					names: ['--body-file <path>'],
					description:
						'the PR body carrying the live-execution evidence `followup` gates on; forwarded to `git -y` alone.',
				},
				{ names: ['--notify-message <text>'], description: 'forwarded to `followup` alone.' },
				{
					names: ['--review'],
					description:
						'runs round 1 beside the gate; after sync and round 1, an owed round 2 runs beside the gate and joins before the PR opens. A High or unfixed Medium stops the ship. A pre-detach `test:pinned` stop probes remaining hunks in the background for the next pre-detach.',
				},
				{
					names: ['--unpinned-ok <reason>'],
					description:
						"forwarded to round 1's `run:review`, past `unpinned` places no test can pin.",
				},
				{
					names: ['--detach'],
					description:
						'hands the ship to a supervisor (implied in a lane child); a stop emits `ship-stop` (`--log <N>`). The preflight, type check, unused exports, cspell, guard tests and (`--review`, under `--unpinned-ok`, given or recorded, only if round 1 is reused) `test:pinned` precede hand-off, the checks even after a preflight refusal, so one stop reports every failure.',
				},
			],
		},
	},
	'ship:wait': {
		script: 'scripts/run/ship/run-ship-wait-main.ts',
		description:
			'Wait on a detached ship through its gate and review round 1, so a stop there returns to this session (returned | passed | ended | pending)',
		category: 'AI tools',
		reference: ['<N>', 'automation', ['files', 'processes']],
		usage: {
			examples: [
				{
					arguments: '<N>',
					note: 're-issue it on `pending` while `cost --cut` is `under`; `returned` prints the stop to fix',
				},
			],
		},
	},
	'ship:evidence': {
		script: 'scripts/run/ship/run-ship-evidence-cli.ts',
		description:
			'Run a command and append its invocation and output tail to the ship body draft’s live-evidence section (exits with the command’s code)',
		category: 'AI tools',
		reference: ['<N> [--fresh] -- <command...>', 'automation', ['files', 'processes']],
		usage: {
			examples: [
				{
					arguments: '<N> -- pnpm josh <command>',
					note: 'the run picks which command is the evidence; the format is written for it',
				},
				{
					arguments: '<N> --fresh -- pnpm josh <command>',
					note: 'runs it even when this tree already holds a recorded run of it',
				},
			],
		},
	},
	'run:event': {
		script: 'scripts/run/event/run-event-cli.ts',
		description:
			'Append to, read or watch the run’s append-only event stream (--append <kind> <text> | --from|--follow <n> | --watch [<n>] | --last)',
		category: 'AI tools',
		reference: [
			'--append <kind> <text> | --from|--follow <n> | --watch [<n>] | --last',
			'automation',
			['files'],
		],
		usage: {
			examples: [
				{ arguments: '--append <kind> <text>', note: 'append one event; prints its position' },
				{ arguments: '--from <position>', note: 'every event after <position>, in order (JSON)' },
				{
					arguments: '--follow <position>',
					note: 'new events, waiting for one; position on stderr',
				},
				{ arguments: '--watch [<position>]', note: 'every new event, rendered, until interrupted' },
				{ arguments: '--last', note: 'the newest event alone' },
			],
		},
	},
	'run:report': {
		script: 'scripts/run/run-report-cli.ts',
		// `.env` rather than the ambient environment: `--handoff` sends the hand-off confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Generate the session-facing report for this invocation from the run’s event stream (merges, parks, cuts) with the release tail — the same text josh notify sends',
		category: 'AI tools',
		// `--end` stops the `run:wake` supervisor process.
		reference: [
			'[--handoff | --end [--stopped "<reason>"]]',
			'automation',
			['files', 'network', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'print the report; the same text josh notify sends' },
				{
					arguments: '--handoff',
					note: 'print the backlogrun hand-off report and send it as the confirmation',
				},
				{
					arguments: '--end',
					note: 'end the run: the report, run:carry --end, run:wake --stop — stops at a failed stage',
				},
				{
					arguments: '--end --stopped "<reason>"',
					note: 'end a run that stopped: run:carry --end --stopped sends the confirmation',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { SHIP_COMMANDS }
