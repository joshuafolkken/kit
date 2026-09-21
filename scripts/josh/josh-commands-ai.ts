import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'
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
	'backlog:next': {
		script: 'scripts/backlog/backlog-next.ts',
		description:
			'Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--repo <owner/repo>]', 'automation', ['network']],
	},
	'backlog:offer': {
		script: 'scripts/backlog/backlog-offer-cli.ts',
		description:
			'Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['network']],
	},
	'backlog:plan': {
		script: 'scripts/backlog/backlog-plan-cli.ts',
		description:
			'Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope',
		category: 'AI tools',
		reference: ['[issue...] [--only]', 'automation', ['network']],
	},
	'backlog:budget': {
		script: 'scripts/backlog/backlog-budget-cli.ts',
		description: 'Say whether a backlogrun may start more work, keep watching, or finish',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['none']],
	},
	cost: {
		script: 'scripts/cost-runtime/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
		reference: ['[--cut|--over]', 'automation', ['none']],
	},
	'doc:section': {
		script: 'scripts/document/document-section-cli.ts',
		description: 'Print one section of a markdown document, for a `file.md` → "Heading" reference',
		category: 'AI tools',
		reference: ['<file> <heading>', 'automation', ['none']],
	},
	'read:set': {
		script: 'scripts/document/read-set-cli.ts',
		description: 'Print what an entry point reads before it starts, and what that read costs',
		category: 'AI tools',
		reference: ['[<entry>] [--json]', 'automation', ['none']],
	},
	'doc:read': {
		script: 'scripts/document/document-read-cli.ts',
		description:
			'Read a whole document safely: print it, or point at the Read tool when over the Bash cap',
		category: 'AI tools',
		reference: ['<file>', 'automation', ['none']],
	},
	'read:files': {
		script: 'scripts/document/read-files-cli.ts',
		description: 'Read several files in one call so edit targets fold into one turn',
		category: 'AI tools',
		reference: ['<path> [<path> ...]', 'automation', ['none']],
	},
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
		reference: ['[--resume] <issue>', 'automation', ['files']],
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
			'Generate the session-facing report from the run’s event stream (merges, parks, cuts) with the release tail — the same text josh notify sends',
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
