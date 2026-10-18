import type { CommandUsage } from './josh-command-types'

// The usage of the run-lifecycle commands `docs/josh-commands-run.md` documents, keyed by command
// name. The page's usage blocks are generated from this table and `josh help <command>` prints it, so
// an example or a flag is written once, here (#3937). The page from `run:progress` on is
// `josh-usage-session.ts`.
const ISSUE = { arguments: '<N>' }
const OUTPUT = '--output <path>'
const OWNER = '--owner <pid>'
const REPO_FLAG = { names: ['--repo <owner/name>'], description: 'a child in another repository.' }

/* eslint-disable @typescript-eslint/naming-convention */
const RUN_USAGE: Readonly<Record<string, CommandUsage>> = {
	'run:hold': {
		examples: [
			{ arguments: '1091', note: 'claim for issue 1091' },
			{ arguments: '1091 --fullrun', note: 'claim as `fullrun #1091` (what `run:entry` runs)' },
		],
		flags: [
			{ names: ['--fullrun'], description: "marks the record as `fullrun #N`'s." },
			{
				names: ['--halfrun-stop'],
				description: 'marks a `halfrun` stop for `run:entry` to adopt.',
			},
			{
				names: ['--prrun-stop'],
				description: 'marks a `prrun` stop with the commit its pull request is on.',
			},
		],
	},
	'run:release': {
		examples: [
			{ arguments: '1091', note: "release this run's own record" },
			{ arguments: '--force', note: 'clear a record left by a run that has ended' },
		],
		flags: [
			{
				names: ['--force'],
				description: "removes a record this run did not write, clearing another run's stale claim.",
			},
		],
	},
	'run:tidy': { examples: [{ arguments: '' }] },
	'run:carry': {
		examples: [
			{ arguments: '--begin "backlogrun --max 5" --owner "$PPID"' },
			{ arguments: '--json', note: 'read the record back in a resumed session' },
			{ arguments: '--cut --owner "$PPID"', note: 'hand the record off before a cut' },
			{
				arguments:
					'--retrospective --summary "0 filed; dropped #2240 already merged" --owner "$PPID"',
				note: 'close the end-of-run retrospective',
			},
			{
				arguments: '--resume "backlogrun --max 5" --owner "$PPID"',
				note: 'adopt a record no cut handed off',
			},
			{
				arguments: '--end --stopped "epic #2126: everything is blocked behind parked #2118"',
				note: 'end + push',
			},
		],
		flags: [
			{
				names: [OWNER],
				description:
					'the long-lived process spending the budget (`$PPID` under a loop); required by counts and `--begin` / `--resume`. A live PID stays `busy` if probes fail.',
			},
			{ names: ['--done <issue>'], description: "shrinks a named-issue run's `remaining` list." },
			{
				names: ['--merged <issue>'],
				description:
					'names the merged issue and counts it once against `merged_issues`, so a merge `run:merge` already recorded is not counted twice.',
			},
			{ names: ['--filed', '--cut'], description: 'increments, never totals.' },
			{
				names: ['--retrospective'],
				description:
					"marks the end-of-run retrospective run, once per invocation, and requires `--summary <text>` — the same close writes that result as one `retrospective` event on the run's event stream (best-effort), so a run that filed zero improvements reads apart from one whose retrospective never ran. Either flag without the other is refused.",
			},
			{
				names: ['--stopped <reason>'],
				description:
					'rides on `--end`: the run stopped rather than finished, so one ⏸️ confirmation is pushed with the reason.',
			},
			{
				names: ['--end'],
				description:
					'over a live record flushes pending ledger lines once (a failed flush goes to stderr and the record is still cleared); first collects each lane the run launched whose issue merged, exactly as `run:merge` would; keeps the run it removes as the last ended run — its invocation, start and end, one record overwritten by the next `--end` — so `run:board` can still draw a finished run.',
			},
		],
	},
	'run:add': {
		examples: [
			{ arguments: '101 102', note: 'ahead of the rest of the queue (`#N` works too)' },
			{ arguments: '101 --no-priority', note: 'at the end of the queue' },
		],
	},
	'run:wake': {
		examples: [
			{ arguments: '--start', note: 'launch the detached supervisor' },
			{ arguments: '--list', note: 'supervisor state, cut/wake counts, latest progress line' },
			{ arguments: '--stop', note: 'stop the supervisor alone' },
			{ arguments: '--loop --interval 30', note: 'run the loop body in the foreground' },
		],
	},
	'run:cut': {
		examples: [
			{ arguments: '1839', note: 'take the cut and hand it to a fresh process' },
			{
				arguments: '--impl 1839 --handoff .josh/tmp/handoff-1839.json',
				note: 'cut mid-implementation, carrying the instruction',
			},
			{ arguments: '--resume 1839', note: "a fresh process's entry check" },
			{ arguments: '--end', note: 'clear the record' },
		],
	},
	'run:liveness': {
		examples: [
			{ arguments: '1169 --output <path>' },
			{ arguments: '1169 --output <path> --window 45 --gap 2 --repo joshuafolkken/app-kit' },
		],
		flags: [
			{
				names: [OUTPUT],
				description:
					'absolute, under the home or temp directory; a symlink is followed and size compared as well as mtime.',
			},
			{
				names: ['--process alive | none'],
				description:
					"overrides the process trace, which the command otherwise reads itself: the child's own command line (`fullrun #<N>`) or its detached ship supervisor.",
			},
			{
				names: ['--window <min>'],
				description: 'silent window the file must be frozen for (default 30).',
			},
			{ names: ['--gap <sec>'], description: 'spacing between samples (default 5).' },
			REPO_FLAG,
		],
	},
	'run:ending': {
		examples: [
			{ arguments: '2118 --output <path>' },
			{ arguments: '2118 --output <path> --repo joshuafolkken/app-kit' },
		],
		flags: [
			{
				names: [OUTPUT],
				description:
					"the child's transcript, absolute and under the home or temp directory (validated the same way `run:liveness --output` is).",
			},
			REPO_FLAG,
		],
	},
	'run:prep': { examples: [ISSUE] },
	'run:entry': {
		examples: [
			{ arguments: '<N>', note: 'a `fullrun`' },
			{ arguments: '<N> --to halfrun', note: 'a run that goes as far as `halfrun`' },
		],
	},
	'run:status': {
		examples: [ISSUE, { arguments: '<N> --repo <owner/repo>', note: 'a cross-repo child' }],
	},
	'run:next': { examples: [ISSUE] },
	'run:step': {
		examples: [
			{ arguments: '<N>', note: "the run's next action for issue <N>" },
			{ arguments: '', note: "the `backlogrun` parent's next action" },
		],
	},
	'run:merge': {
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
	'run:review': {
		examples: [
			{
				arguments: '',
				note: 'detach the gate, print the brief; then launch the /code-review subagent',
			},
			{ arguments: '--join', note: 'after the review returns: join the gate, check its verdict' },
		],
	},
	'run:tail': {
		examples: [
			{ arguments: '<N>', note: 'the closed issue' },
			{ arguments: '<N> <follow-up-N>', note: 'and a follow-up filed this run' },
		],
	},
	ship: {
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
	'run:report': {
		examples: [{ arguments: '', note: 'print the report; the same text josh notify sends' }],
	},
	'run:event': {
		examples: [
			{ arguments: '--append <kind> <text>', note: 'append one event; prints its position' },
			{ arguments: '--from <position>', note: 'every event after <position>, in order (JSON)' },
			{ arguments: '--follow <position>', note: 'new events, waiting for one; position on stderr' },
			{ arguments: '--watch [<position>]', note: 'every new event, rendered, until interrupted' },
			{ arguments: '--last', note: 'the newest event alone' },
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { RUN_USAGE }
