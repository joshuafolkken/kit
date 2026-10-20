import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'
import { PAUSE_COMMANDS } from './josh-commands-pause'
import { PROGRESS_COMMANDS } from './josh-commands-progress'

const OWNER = '--owner <pid>'
const OUTPUT = '--output <path>'
const REPO_FLAG = { names: ['--repo <owner/name>'], description: 'a child in another repository.' }
const ISSUE = { arguments: '<N>' }

// The run-lifecycle registry (`run:hold` through `run:step`), split out of `josh-commands-ai.ts` so
// that file stays under its 300-code-line limit, as `BACKLOG_COMMANDS` and `LANE_COMMANDS` are. It
// is spread into `AI_COMMANDS` at the place the entries belong, so the generated catalog keeps their
// order.

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/hold/run-hold-cli.ts'

/* eslint-disable @typescript-eslint/naming-convention */
const RUN_COMMANDS: Record<string, CommandEntry> = {
	'run:hold': {
		script: RUN_HOLD_SCRIPT,
		description: 'Claim this working tree for a run, or say which run already holds it',
		category: 'AI tools',
		// A `--halfrun-stop` / `--human-review-stop` / `--prrun-stop` sends the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [
			'[<issue> [--fullrun | --halfrun-stop | --human-review-stop | --prrun-stop]] | --adopt <issue>',
			'automation',
			['files'],
		],
		usage: {
			examples: [
				{ arguments: '1091', note: 'claim for issue 1091' },
				{ arguments: '1091 --fullrun', note: 'claim as `fullrun #1091` (what `run:entry` runs)' },
				{ arguments: '--adopt 1091', note: "hand a `new` run's hold to the issue it filed" },
			],
			flags: [
				{ names: ['--fullrun'], description: "marks the record as `fullrun #N`'s." },
				{
					names: ['--adopt <issue>'],
					description:
						"re-keys the unnumbered `new` run's record to the filed issue and applies `in-progress`; answers `none` (exit 1) when the tree holds no record.",
				},
				{
					names: ['--halfrun-stop'],
					description:
						'marks a `halfrun` stop for `run:entry` to adopt, and sends its `confirmation` Telegram; answers `e2e-owed` (exit 1) until `test:e2e` answered green on this tree.',
				},
				{
					names: ['--human-review-stop'],
					description:
						'marks a `needs-human-review` stop as a `halfrun` stop, and sends its `confirmation` Telegram naming the lane; answers `e2e-owed` (exit 1) until `test:e2e` answered green on this tree.',
				},
				{
					names: ['--prrun-stop'],
					description:
						'marks a `prrun` stop with the commit its pull request is on, and sends its `confirmation` Telegram.',
				},
			],
		},
	},
	'run:release': {
		script: RUN_HOLD_SCRIPT,
		description: "Release this working tree's run record",
		category: 'AI tools',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: ['[issue|--force]', 'automation', ['files']],
		default_script_arguments: ['--release'],
		usage: {
			examples: [
				{ arguments: '1091', note: "release this run's own record" },
				{ arguments: '--force', note: 'clear a record left by a run that has ended' },
			],
			flags: [
				{
					names: ['--force'],
					description:
						"removes a record this run did not write, clearing another run's stale claim.",
				},
			],
		},
	},
	...PAUSE_COMMANDS,
	'run:tidy': {
		script: 'scripts/run/tidy/run-tidy-cli.ts',
		description: 'Close merged lanes and drop stashes whose issues are all merged',
		category: 'AI tools',
		reference: ['', 'automation', ['git', 'network', 'files']],
		usage: { examples: [{ arguments: '' }] },
	},
	'run:carry': {
		script: 'scripts/run/carry/run-carry-cli.ts',
		// `--stopped` sends the stop confirmation, so the Telegram credentials come from `.env` as for
		// `run:wake` below.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Carry one invocation’s budget across its own session cuts',
		category: 'AI tools',
		reference: ['<operation> [arguments...]', 'automation', ['files']],
		usage: {
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
	},
	'run:add': {
		script: 'scripts/run/add/run-add-cli.ts',
		description: 'Add issues to a live backlogrun, ahead of the queue unless --no-priority',
		category: 'AI tools',
		reference: ['<issue...> [--no-priority]', 'automation', ['network', 'files']],
		usage: {
			examples: [
				{ arguments: '101 102', note: 'ahead of the rest of the queue (`#N` works too)' },
				{ arguments: '101 --no-priority', note: 'at the end of the queue' },
			],
		},
	},
	'run:wake': {
		script: 'scripts/run/wake/run-wake-cli.ts',
		// `.env` rather than the ambient environment:
		// the failure warning needs the Telegram credentials, the same
		// reasons `notify` and `followup` carry these flags.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Wake the next session of a cut backlogrun from outside the conversation',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['processes', 'notifications']],
		usage: {
			examples: [
				{ arguments: '--start', note: 'launch the detached supervisor' },
				{ arguments: '--list', note: 'supervisor state, cut/wake counts, latest progress line' },
				{ arguments: '--stop', note: 'stop the supervisor alone' },
				{ arguments: '--loop --interval 30', note: 'run the loop body in the foreground' },
			],
		},
	},
	'run:cut': {
		script: 'scripts/run/cut/run-cut-cli.ts',
		description: 'Cut a lane child before the gate and resume a fresh process',
		category: 'AI tools',
		reference: ['[--resume] <issue> [--impl] [--handoff <path>]', 'automation', ['files']],
		usage: {
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
	},
	'run:park': {
		script: 'scripts/run/park/run-park-cli.ts',
		description: 'Park a lane child for a decision, or clear the park',
		category: 'AI tools',
		reference: ['<issue> --body-file <path> | <issue> --clear', 'automation', ['files', 'network']],
		usage: {
			examples: [
				{
					arguments: '1839 --body-file .josh/tmp/park-1839.md',
					note: 'comment, needs-decision and the local record',
				},
				{ arguments: '1839 --clear', note: 'remove needs-decision and the record' },
			],
		},
	},
	'run:liveness': {
		script: 'scripts/run/run-liveness-cli.ts',
		description: 'Say whether a delegated unit is still working, or stopped without reporting',
		category: 'AI tools',
		reference: ['<issue> --output <path> [options]', 'automation', ['processes']],
		usage: {
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
	},
	'run:ending': {
		script: 'scripts/run/run-ending-cli.ts',
		description: 'Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable)',
		category: 'AI tools',
		reference: ['<issue> --output <path> [--repo <owner/repo>]', 'automation', ['network']],
		usage: {
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
	},
	...PROGRESS_COMMANDS,
	'run:prep': {
		script: 'scripts/run/run-prep-cli.ts',
		description: 'Bundle a run’s pre-edit reads: body, comments, state, dependency scope',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
		usage: { examples: [ISSUE] },
	},
	// The entry sequence a lane opened on, folded into one call: claim the tree,
	// read the budget, gather the issue reads and decide the pre-implementation step. `run:hold`,
	// `cost --cut`, `run:prep` and `run:step` were four round trips re-billing a lane's full context each.
	'run:entry': {
		script: 'scripts/run/entry/run-entry-cli.ts',
		// A `busy` hold or an `over` budget sends the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step',
		category: 'AI tools',
		reference: ['<issue> [--to <command>]', 'automation', ['git', 'network', 'files']],
		usage: {
			examples: [
				{ arguments: '<N>', note: 'a `fullrun`' },
				{ arguments: '<N> --to halfrun', note: 'a run that goes as far as `halfrun`' },
			],
		},
	},
	'run:status': {
		script: 'scripts/run/run-status-cli.ts',
		description: 'Bundle a run’s read-only status: issue state, cost verdict, carry counters',
		category: 'AI tools',
		reference: ['<issue> [--repo <owner/repo>]', 'automation', ['network']],
		usage: {
			examples: [ISSUE, { arguments: '<N> --repo <owner/repo>', note: 'a cross-repo child' }],
		},
	},
	'run:next': {
		script: 'scripts/run/run-next-cli.ts',
		description: 'Print the next step a fullrun takes, computed from the run’s state',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
		usage: { examples: [ISSUE] },
	},
	'run:step': {
		script: 'scripts/run/run-step-cli.ts',
		description:
			'Print the run’s next single action, computed from the event stream, carry record and issue state',
		category: 'AI tools',
		reference: ['[<issue>]', 'automation', ['network', 'files']],
		usage: {
			examples: [
				{ arguments: '<N>', note: "the run's next action for issue <N>" },
				{ arguments: '', note: "the `backlogrun` parent's next action" },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { RUN_COMMANDS }
