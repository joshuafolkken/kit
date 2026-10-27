import { core_weights } from '#scripts/gate/core-weights'
import type { CommandEntry } from './josh-command-types'
import { BACKLOG_COMMANDS } from './josh-commands-backlog'
import { DOCUMENT_COMMANDS } from './josh-commands-document'
import { EPIC_COMMANDS } from './josh-commands-epic'
import { ISSUE_COMMANDS } from './josh-commands-issue'
import { LANE_COMMANDS } from './josh-commands-lane'
import { REVIEW_COMMANDS } from './josh-commands-review'
import { RUN_COMMANDS } from './josh-commands-run'
import { SHIP_COMMANDS } from './josh-commands-ship'
import { SPLIT_COMMANDS } from './josh-commands-split'

const DIR = '--dir <path>'
const PATH_DIR = '--path <dir>'
const BARE = { arguments: '' }

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	...ISSUE_COMMANDS,
	'pkg:scout': {
		script: 'scripts/package/package-scout-cli.ts',
		description:
			'Rank package candidates by measured metrics so the Package-First tier decision is read, not judged',
		category: 'AI tools',
		reference: ['<keywords> [--size <n>]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '"date formatting" --size 5' }],
			flags: [
				{
					names: ['--size <n>'],
					description: 'how many candidates to fetch and rank (default 10).',
				},
			],
		},
	},
	'stash:push': {
		script: 'scripts/git/stash/stash-push-main.ts',
		description: 'Stash the working tree, untracked files included, leaving the observation ledger',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
		usage: {
			examples: [{ arguments: '"backlogrun: josh latest before lanes"' }],
			flags: [
				{
					names: [DIR],
					description: 'stashes that work tree (`git -C <path>`); without it the current checkout.',
				},
			],
		},
	},
	'stash:pop': {
		script: 'scripts/git/stash/stash-pop-main.ts',
		description: 'Pop the stash matching this message, not whichever a shared stack has on top',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
		usage: {
			examples: [
				{ arguments: '"backlogrun: parked #2028"' },
				{
					arguments: '"backlogrun: josh latest before lanes" --dir "$dir"',
					note: "into a lane's work tree",
				},
			],
			flags: [
				{
					names: [DIR],
					description:
						'applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.',
				},
			],
		},
	},
	...EPIC_COMMANDS,
	...BACKLOG_COMMANDS,
	cost: {
		script: 'scripts/cost-runtime/cost-main.ts',
		description:
			'Say whether the next turn of a run crosses the context-cut threshold (--cut) or a given tokens-per-request figure (--over)',
		category: 'AI tools',
		reference: ['(--cut | --over <tokens-per-request>) [--path <dir>]', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: '--cut',
					note: 'compare billed input per request with the shared 135,000 context-cut threshold',
				},
				{ arguments: '--over <tokens>', note: 'compare with an explicit limit' },
				{ arguments: `--cut ${PATH_DIR}`, note: 'Anthropic project or current OpenAI worktree' },
			],
			flags: [
				{
					names: [PATH_DIR],
					description:
						'selects another Anthropic project; OpenAI accepts only linked checkouts of the current project.',
				},
			],
		},
	},
	'cost:audit': {
		script: 'tools/cost-audit/cost-audit-main.ts',
		description:
			'Report AI cost over a period by session kind, tool category and guard, with cost per merge and regressions against the period before',
		category: 'AI tools',
		reference: ['[--period <days>]', 'maintainer', ['none']],
		// Kit-only: it reads kit's own transcript store, like `josh retrospective`, which carries its
		// summary line.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'the last 7 days against the 7 before' },
				{ arguments: '--period 30', note: 'the last 30 days against the 30 before' },
			],
			flags: [
				{
					names: ['--period <days>'],
					description: 'the length of each period, a positive whole number of days (default 7).',
				},
			],
		},
	},
	...DOCUMENT_COMMANDS,
	time: {
		script: 'tools/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
		reference: ['[options]', 'maintainer', ['none']],
		// Kit-only: it measures kit's own development runs and its report modules live under the
		// undistributed `tools/time/`, so it means nothing in a consumer project and is dropped from a
		// consumer's help. The runtime analysis hooks and guards rely on stays
		// distributed under `scripts/time-runtime/`.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'the last run tree, wall clock and cost by role' },
				{ arguments: '--run', note: 'the same run-tree scope, named explicitly' },
				{ arguments: '--json', note: 'the same figures, machine-readable' },
				{ arguments: PATH_DIR, note: "read another project's transcripts from this checkout" },
				{
					arguments: '--split-at 2026-10-16T21:33:19Z',
					note: 'the same tree compared by role before and after a merge',
				},
			],
			flags: [
				{
					names: ['--run'],
					description:
						'(default) the whole run tree, wall clock led beside dollars. It is the only scope; any flag not listed here is a usage error (exit 1). History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".',
				},
				{
					names: [PATH_DIR],
					description:
						'aim the read at another project (absolute path); keeps the `cwd` behavior when absent.',
				},
				{ names: ['--json'], description: 'the run tree, machine-readable.' },
				{
					names: ['--split-at <ISO time>'],
					description:
						'add a before → after block by role (time share, cost share, req/session), each session on the side of its first request; an unparseable time is a usage error (exit 1).',
				},
			],
		},
	},
	// The tool-calls-per-round-trip density the batching guard is measured on, aggregated across the
	// recent lane sessions. Kit-only for the same reason `time` is: it reads
	// kit's own lane transcripts and means nothing in a consumer project.
	'time:density': {
		script: 'tools/time/time-density-cli.ts',
		description: 'Report tool calls per round trip across the recent lane sessions',
		category: 'AI tools',
		reference: ['[--lanes <n>] [--path <dir>]', 'maintainer', ['none']],
		is_kit_only: true,
		usage: {
			examples: [{ arguments: '' }, { arguments: '--lanes 5', note: 'the five most recent lanes' }],
			flags: [
				{
					names: ['--lanes <n>'],
					description: 'average over a different count of recent qualifying lanes (default 10).',
				},
				{
					names: [PATH_DIR],
					description:
						"read another project's lane transcripts, as `josh time` does. Run from a lane, it reads its main checkout's lanes.",
				},
			],
		},
	},
	retrospective: {
		script: 'tools/retrospective/retrospective-cli.ts',
		description:
			"Aggregate a finished run's cost, review findings, observation ledger and events into one digest",
		category: 'AI tools',
		reference: ['', 'maintainer', ['none']],
		core_weight: core_weights.CORE_WEIGHTS.retrospective,
		memory_mb: core_weights.MEMORY_MB.retrospective,
		// Kit-only: it reads kit's own development run — the transcript store, the review ledger and the
		// run event stream — so it means nothing in a consumer project and is dropped from a consumer's
		// help, through the same declaration `josh time` uses for the same reason.
		is_kit_only: true,
		usage: {
			examples: [{ arguments: '', note: 'the digest for the run this checkout carries' }],
		},
	},
	...REVIEW_COMMANDS,
	...RUN_COMMANDS,
	'repo:party': {
		script: 'scripts/discovery/repo-party-cli.ts',
		description:
			'Say whether a repository is first-party or third-party by owner equality (computed, not judged)',
		category: 'AI tools',
		reference: ['[<owner/repo>]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'joshuafolkken/kit', note: '→ first-party (in the kit session)' },
				{ arguments: 'sveltejs/kit', note: '→ third-party' },
				{ arguments: '', note: "no argument: the session's own repository" },
			],
		},
	},
	...SHIP_COMMANDS,
	...LANE_COMMANDS,
	'run:watcher:guard': {
		script: 'scripts/run/run-watcher-guard-cli.ts',
		description:
			'Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [BARE] },
	},
	...SPLIT_COMMANDS,
	'oracle:list': {
		script: 'scripts/rules/oracle-list-cli.ts',
		description: 'Print the decision oracles — commands that answer a rule question mechanically',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '' }] },
	},
	eval: {
		script: 'tools/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
		reference: ['[scenario...]', 'maintainer', ['processes', 'network']],
		// Kit-only: it replays kit's own distributed rules against real Claude sessions, so it means
		// nothing in a consumer project and is dropped from a consumer's help.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'every scenario' },
				{ arguments: 'consult-not-execute', note: 'one scenario by name' },
			],
			flags: [
				{ names: ['JOSH_EVAL_MODEL'], description: 'the model to run against (default `sonnet`).' },
				{
					names: ['JOSH_EVAL_CONCURRENCY'],
					description:
						'how many sessions run at once (default `5`); a non-positive-integer value is refused.',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
