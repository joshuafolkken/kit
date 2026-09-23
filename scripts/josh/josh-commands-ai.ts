import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'
import { BACKLOG_COMMANDS } from './josh-commands-backlog'
import { DOCUMENT_COMMANDS } from './josh-commands-document'
import { GUARD_COMMANDS } from './josh-commands-guard'
import { ISSUE_COMMANDS } from './josh-commands-issue'
import { LANE_COMMANDS } from './josh-commands-lane'
import { SPLIT_COMMANDS } from './josh-commands-split'

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/run-hold-cli.ts'
const ISSUE_WITH_OPTIONS = '<issue> [options]'

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	...ISSUE_COMMANDS,
	'pkg:scout': {
		script: 'scripts/package/package-scout-cli.ts',
		description:
			'Rank package candidates by measured metrics so the Package-First tier decision is read, not judged',
		category: 'AI tools',
		reference: ['<keywords> [--size <n>]', 'automation', ['network']],
	},
	'stash:pop': {
		script: 'scripts/git/stash-pop-cli.ts',
		description: 'Pop the stash matching this message, not whichever a shared stack has on top',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
	},
	epic: {
		script: 'scripts-ai/epic.ts',
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
		reference: ['<title> <issue...> [--ordered]', 'automation', ['network']],
	},
	'epic:next': {
		script: 'scripts/epic/epic-next.ts',
		description: "List an epic's runnable children, bundled per repository",
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'epic:bundle': {
		script: 'scripts/epic/epic-bundle-cli.ts',
		description: 'Say whether a newly filed issue belongs with ones already in the backlog',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	'epic:audit': {
		script: 'scripts/epic/epic-audit-cli.ts',
		description: "Audit an epic's children against each other for contradictions",
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'epic:check': {
		script: 'scripts-ai/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'auto-ok:next': {
		script: 'scripts/auto-ok/auto-ok-cli.ts',
		description: 'Print the next opted-in issue an unattended run may pick up outside an epic',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--label <name>]', 'automation', ['network']],
	},
	...BACKLOG_COMMANDS,
	cost: {
		script: 'scripts/cost-runtime/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
		reference: ['[--cut|--over]', 'automation', ['none']],
	},
	...DOCUMENT_COMMANDS,
	time: {
		script: 'scripts/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
		reference: ['[options]', 'maintainer', ['none']],
		// Kit-only: it measures kit's own development runs and its report modules live under the
		// undistributed `scripts/time/`, so it means nothing in a consumer project and is dropped from a
		// consumer's help (joshuafolkken/kit#1997). The runtime analysis hooks and guards rely on stays
		// distributed under `scripts/time-runtime/`.
		is_kit_only: true,
	},
	// The tool-calls-per-round-trip density the batching guard is measured on, aggregated across the
	// recent lane sessions (joshuafolkken/kit#2405). Kit-only for the same reason `time` is: it reads
	// kit's own lane transcripts and means nothing in a consumer project.
	'time:density': {
		script: 'scripts/time/time-density-cli.ts',
		description: 'Report tool calls per round trip across the recent lane sessions',
		category: 'AI tools',
		reference: ['[--lanes <n>] [--path <dir>]', 'maintainer', ['none']],
		is_kit_only: true,
	},
	retrospective: {
		script: 'scripts/retrospective/retrospective-cli.ts',
		description:
			"Aggregate a finished run's cost, review findings, observation ledger and events into one digest",
		category: 'AI tools',
		reference: ['', 'maintainer', ['none']],
		// Kit-only: it reads kit's own development run — the transcript store, the review ledger and the
		// run event stream — so it means nothing in a consumer project and is dropped from a consumer's
		// help (joshuafolkken/kit#2328), through the same declaration `josh time` uses for the same reason.
		is_kit_only: true,
	},
	'review:brief': {
		script: 'scripts/review/review-brief-cli.ts',
		description:
			'Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone)',
		category: 'AI tools',
		reference: ['[--round <1|2>] | --level-only [--staged] [--json]', 'automation', ['files']],
	},
	'review:attest': {
		script: 'scripts/review/review-attest-cli.ts',
		description: 'Record, or verify, which checkout a /code-review actually read',
		category: 'AI tools',
		reference: ['<nonce> | --check', 'automation', ['files']],
	},
	'review:round2': {
		script: 'scripts/review/review-round2-cli.ts',
		description: 'Say whether the second /code-review round is due, or may be skipped entirely',
		category: 'AI tools',
		reference: ['[--round-1-closed] [--json]', 'automation', ['none']],
	},
	delegate: {
		script: 'scripts/delegation/delegation-cli.ts',
		description: 'Say whether a run step may go to a cheaper execution tier',
		category: 'AI tools',
		reference: ['<step> | --list', 'automation', ['none']],
	},
	fanout: {
		script: 'scripts/delegation/fanout-cli.ts',
		description:
			'Say whether proposed implementation units are file-disjoint, so they may run in parallel',
		category: 'AI tools',
		reference: ['<unit-files> <unit-files> [<unit-files> …]', 'automation', ['none']],
	},
	'run:hold': {
		script: RUN_HOLD_SCRIPT,
		description: 'Claim this working tree for a run, or say which run already holds it',
		category: 'AI tools',
		reference: ['[issue]', 'automation', ['files']],
	},
	'run:release': {
		script: RUN_HOLD_SCRIPT,
		description: "Release this working tree's run record",
		category: 'AI tools',
		reference: ['[issue|--force]', 'automation', ['files']],
		default_script_arguments: ['--release'],
	},
	'run:carry': {
		script: 'scripts/run/run-carry-cli.ts',
		description: 'Carry one invocation’s budget across its own session cuts',
		category: 'AI tools',
		reference: ['<operation> [arguments...]', 'automation', ['files']],
	},
	'run:wake': {
		script: 'scripts/run/run-wake-cli.ts',
		// `.env` rather than the ambient environment:
		// the failure warning needs the Telegram credentials, the same
		// reasons `notify` and `followup` carry these flags.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Wake the next session of a cut backlogrun from outside the conversation',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['processes', 'notifications']],
	},
	'run:cut': {
		script: 'scripts/run/run-cut-cli.ts',
		description: 'Cut a lane child before the gate and resume a fresh process',
		category: 'AI tools',
		reference: ['[--resume] <issue> [--impl|--setup] [--handoff <path>]', 'automation', ['files']],
	},
	'run:liveness': {
		script: 'scripts/run/run-liveness-cli.ts',
		description: 'Say whether a delegated unit is still working, or stopped without reporting',
		category: 'AI tools',
		reference: ['<issue> --output <path> [options]', 'automation', ['processes']],
	},
	'run:ending': {
		script: 'scripts/run/run-ending-cli.ts',
		description: 'Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable)',
		category: 'AI tools',
		reference: ['<issue> --output <path> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'run:progress': {
		script: 'scripts/run/run-progress-cli.ts',
		description: 'Report an unattended run’s progress once it has gone quiet for an interval',
		category: 'AI tools',
		reference: ['[--wait|--mark]', 'automation', ['files']],
	},
	'run:prep': {
		script: 'scripts/run/run-prep-cli.ts',
		description: 'Bundle a run’s pre-edit reads: body, comments, state, dependency scope',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	// The entry sequence a lane opened on, folded into one call (joshuafolkken/kit#2372): claim the tree,
	// read the budget, gather the issue reads and decide the pre-implementation step. `run:hold`,
	// `cost --cut`, `run:prep` and `run:step` were four round trips re-billing a lane's full context each.
	'run:entry': {
		script: 'scripts/run/run-entry-cli.ts',
		description:
			'Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['git', 'network', 'files']],
	},
	'run:status': {
		script: 'scripts/run/run-status-cli.ts',
		description: 'Bundle a run’s read-only status: issue state, cost verdict, carry counters',
		category: 'AI tools',
		reference: ['<issue> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'run:next': {
		script: 'scripts/run/run-next-cli.ts',
		description: 'Print the next step a fullrun takes, computed from the run’s state',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	'run:step': {
		script: 'scripts/run/run-step-cli.ts',
		description:
			'Print the run’s next single action, computed from the event stream, carry record and issue state',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network', 'files']],
	},
	'repo:party': {
		script: 'scripts/discovery/repo-party-cli.ts',
		description:
			'Say whether a repository is first-party or third-party by owner equality (computed, not judged)',
		category: 'AI tools',
		reference: ['[<owner/repo>]', 'automation', ['none']],
	},
	'run:merge': {
		script: 'scripts/run/run-merge-cli.ts',
		description:
			'Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['git', 'network']],
	},
	'run:review': {
		script: 'scripts/run/run-review-cli.ts',
		description:
			'Start the gate in the background and print the /code-review brief in one call so the two overlap (--join to join the gate and check its verdict)',
		category: 'AI tools',
		reference: ['[--join]', 'automation', ['processes', 'files']],
	},
	// The post-merge sequence a run closed on, folded into one call (joshuafolkken/kit#2372): commit the
	// observation ledger, read the completion citations and decide the release scope. `observations:flush`,
	// `issue:cite` and `release:scope` were three round trips re-billing the run's full context each.
	'run:tail': {
		script: 'scripts/run/run-tail-cli.ts',
		description:
			'Close a run in one call: commit the observation ledger, read the citations, decide the release scope',
		category: 'AI tools',
		reference: ['[<issue> ...]', 'automation', ['git', 'network']],
	},
	// The commit-to-report region a run ships a change on, folded into one call (joshuafolkken/kit#2398):
	// the gate, the commit/push/PR (`git -y`), the CI-wait merge (`followup`) and the report bookkeeping
	// (`run:tail`) were four round trips re-billing the run's full context each. It stops at the first
	// failed step and names it, so the run reads only the step to fix.
	ship: {
		script: 'scripts/run/run-ship-cli.ts',
		description:
			'Ship a change in one call: gate, commit/push/PR, the CI-wait merge and the report bookkeeping, stopping at the first failed step',
		category: 'AI tools',
		reference: [
			'"<title> #<N>" [<follow-up-N> ...] [--cite <N>] [--review] [--detach] [--notify-message <text> | --notify-message-file <path>] | --log <N>',
			'automation',
			['git', 'network'],
		],
	},
	'run:event': {
		script: 'scripts/run/run-event-cli.ts',
		description:
			'Append to or read the run’s append-only event stream (--append <kind> <text> | --from|--follow <n> | --last)',
		category: 'AI tools',
		reference: ['--append <kind> <text> | --from|--follow <n> | --last', 'automation', ['files']],
	},
	'run:report': {
		script: 'scripts/run/run-report-cli.ts',
		description:
			'Generate the session-facing report for this invocation from the run’s event stream (merges, parks, cuts) with the release tail — the same text josh notify sends',
		category: 'AI tools',
		reference: ['', 'automation', ['files', 'network']],
	},
	...LANE_COMMANDS,
	...GUARD_COMMANDS,
	'run:watcher:guard': {
		script: 'scripts/run/run-watcher-guard-cli.ts',
		description:
			'Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	'run:stranded': {
		script: 'scripts/run/run-stranded-cli.ts',
		// `.env` rather than the ambient environment: the strand notification needs the Telegram
		// credentials, the same reason `run:wake` carries these flags.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Report whether the run is stranded — budget handed off, owner gone, and no supervisor watching',
		category: 'AI tools',
		reference: ['', 'automation', ['processes', 'notifications']],
	},
	...SPLIT_COMMANDS,
	'oracle:list': {
		script: 'scripts/rules/oracle-list-cli.ts',
		description: 'Print the decision oracles — commands that answer a rule question mechanically',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	eval: {
		script: 'scripts/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
		reference: ['[scenario...]', 'maintainer', ['processes', 'network']],
		// Kit-only: it replays kit's own distributed rules against real Claude sessions, so it means
		// nothing in a consumer project and is dropped from a consumer's help (joshuafolkken/kit#1988).
		is_kit_only: true,
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
