import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_open } from '#scripts/lane/lane-open'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import type { WorkflowHandoff, WorkflowKeyword } from './run-handoff-args'

// The work tree a hand-off's child runs in (joshuafolkken/kit#8994).
//
// **A numbered run that edits gets a lane; nothing else leaves the checkout it was typed in.**
// `fullrun` / `halfrun` / `prrun #N` open (or reuse) the lane `lane:open <N>` makes — its own branch,
// dependencies and port seed, and for `prrun` the open PR's branch (`lane-pr-branch.ts`) — so no single
// run edits the primary checkout. `kickoff` and `retrospective` edit nothing, and a `new` run has no
// number to name a lane by until it files: it starts here and hands itself on once numbered
// (`fullrun-steps.md` → "The `fullrun new` step list").
//
// After the merge, `followup` syncs the primary checkout, `run:tail` keeps a linked tree as it is, and the
// maintenance sweep closes the merged lane once its run has ended (`run-tidy-lanes.ts`).

const ISSUE_TOKEN = /#(\d+)/u
const LANE_KEYWORDS: ReadonlySet<WorkflowKeyword> = new Set(['fullrun', 'halfrun', 'prrun'])
const FULL_NOTE =
	'every lane seat is taken; close a finished lane with `pnpm josh lane:close <N>` and hand off again'

interface TreePorts {
	cwd: string
	// The directory of the lane opened for `<issue>`, or `undefined` when every seat is taken.
	lane_directory: (issue: string) => Promise<string | undefined>
}

type TreeResult = { kind: 'tree'; directory: string } | { kind: 'refused'; note: string }

// The line's first `#N` — the issue the run claims under — or `undefined` for an unnumbered run.
function issue_of(line: string): string | undefined {
	return ISSUE_TOKEN.exec(line)?.[1]
}

async function work_tree(handoff: WorkflowHandoff, ports: TreePorts): Promise<TreeResult> {
	const issue = issue_of(handoff.line)

	if (issue === undefined || !LANE_KEYWORDS.has(handoff.keyword)) {
		return { kind: 'tree', directory: ports.cwd }
	}

	const directory = await ports.lane_directory(issue)

	return directory === undefined
		? { kind: 'refused', note: FULL_NOTE }
		: { kind: 'tree', directory }
}

async function lane_directory(issue: string): Promise<string | undefined> {
	const outcome = await lane_open.open_lane(issue)

	return outcome.kind === 'full' ? undefined : outcome.lane.directory
}

// The hold `run:entry` claims for the tree at `directory`; an unknown tree reads as unreadable, never free.
async function tree_hold(directory: string): Promise<HoldRead> {
	const git_directory = git_common_directory.own(directory)

	if (git_directory === undefined) return { kind: 'unreadable' }

	return run_hold.read_hold(run_hold.hold_path(git_directory))
}

const run_handoff_tree = { issue_of, work_tree, lane_directory, tree_hold }

export { run_handoff_tree }
