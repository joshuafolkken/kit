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
		script: 'scripts/run/merge/run-merge-cli.ts',
		description:
			'Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['git', 'network']],
		usage: {
			examples: [
				{
					arguments: '<N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>',
					note: 'prints the next child number, or a verdict',
				},
				{ arguments: '<N> --owner "$PPID"', note: 'backlog offer (no epic)' },
			],
			flags: [
				{
					names: ['--epic <E>', '--repo <owner/repo>'],
					description: "offer the epic's next children; omit both for the opted-in backlog.",
				},
				{
					names: [OWNER],
					description: "the parent's process, so the carry count respects the ownership guard.",
				},
				{
					names: [OUTPUT],
					description: 'the transcript the outage split reads; absent, it is off.',
				},
				{
					names: ['--driver'],
					description:
						'the caller is `backlog:drive`, which has no context to cut, so the merge is never handed back `over`.',
				},
			],
		},
	},
	'run:review': {
		script: 'scripts/run/review/run-review-cli.ts',
		description:
			'Start the gate in the background and print the /code-review brief in one call so the two overlap (--join to join the gate and check its verdict)',
		category: 'AI tools',
		reference: ['[--join]', 'automation', ['processes', 'files']],
		usage: {
			examples: [
				{
					arguments: '',
					note: 'detach the gate, print the brief; then launch the /code-review subagent',
				},
				{ arguments: '--join', note: 'after the review returns: join the gate, check its verdict' },
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
			'"<title> #<N>" [<follow-up-N> ...] [--cite <N>] [--review] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | --log <N>',
			'automation',
			['git', 'network'],
		],
		usage: {
			examples: [
				{ arguments: '"<title> #<N>" --body-file <evidence.md>' },
				{ arguments: '"<title> #<N>" --review', note: 'both review rounds inside the ship' },
				{ arguments: '--detach "<title> #<N>"', note: 'hand the ship to a supervisor' },
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
						'runs review round 1 beside the gate, and round 2 after the commit when `review:round2` requires it; a High or an unfixed Medium stops the ship.',
				},
				{
					names: ['--detach'],
					description:
						'hands the ship to a supervisor (implied in a lane child); a stop emits `ship-stop` (`--log <N>`). The preflight, type check, unused exports, cspell and guard tests run before the hand-off; a stop returns to the same session.',
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
		reference: ['[--handoff]', 'automation', ['files', 'network']],
		usage: {
			examples: [
				{ arguments: '', note: 'print the report; the same text josh notify sends' },
				{
					arguments: '--handoff',
					note: 'print the backlogrun hand-off report and send it as the confirmation',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { SHIP_COMMANDS }
