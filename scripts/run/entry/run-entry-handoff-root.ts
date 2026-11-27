import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_paths, type LaneEnvironment } from '#scripts/lane/lane-paths'
import { run_headless } from '#scripts/run/run-headless'
import { run_headless_keys } from '#scripts/run/run-headless-keys'
import { run_stage } from '#scripts/run/run-stage'
import type { EntryRequest } from './run-entry-children'

// A `run:handoff` child claims an issue only in that issue's own tree (joshuafolkken/kit#9103).
//
// A `fullrun new` child starts in the checkout it was typed in, since it has no number to name a lane by
// until it files (`run-handoff-tree.ts`). Once filed, its run belongs in the lane: an entry here would
// claim this checkout, switch it to the issue's branch and implement beside the lane `backlogrun` opens
// for the same freshly filed `auto-ok` issue. So the entry refuses and names the hand-off into the lane.
// The issue's own lane, or a checkout already on its branch — where `run:handoff` keeps the run — passes;
// `kickoff` claims nothing and always passes.

const { HANDOFF_CHILD_KEY } = run_headless_keys

// Root is never the fallback: every `run:handoff` refusal (seats full, `lane:open` failed, a held lane,
// a launch failure) leaves the issue to the lane `backlogrun` opens for it.
const REFUSED_HANDOFF_NOTE = 'If run:handoff refuses, end with its note and the issue URL'

interface RootPorts {
	readonly cwd: string
	readonly environment: LaneEnvironment
	readonly branch_at: (directory: string) => Promise<string>
}

function live_ports(): RootPorts {
	return { cwd: process.cwd(), environment: process.env, branch_at: git_command.branch_at }
}

function is_handoff_child(environment: LaneEnvironment): boolean {
	const marked = run_headless.handoff_child_environment()[HANDOFF_CHILD_KEY]

	return environment[HANDOFF_CHILD_KEY] === marked
}

async function is_own_tree(issue_number: string, ports: RootPorts): Promise<boolean> {
	if (lane_paths.lane_issue_of(ports.cwd, ports.environment) === issue_number) return true

	return git_branch.issue_from_branch(await ports.branch_at(ports.cwd)) === Number(issue_number)
}

function refusal_text({ issue_number, command }: EntryRequest, cwd: string): string {
	const handoff = `pnpm josh run:handoff ${command} ${issue_number} --brief-file <path>`

	return [
		`run:entry ${issue_number}: a run:handoff child does not claim ${cwd} —`,
		`it is neither ${session_cite.issue(issue_number)}'s lane nor on its branch.`,
		`Hand the run into its lane and end: \`pnpm josh run:release\`, then \`${handoff}\`.`,
		`${REFUSED_HANDOFF_NOTE} — the issue stays filed for its lane.`,
		'(fullrun-steps.md → "The `fullrun new` step list").',
	].join('\n')
}

// `true` after printing why, when a hand-off child's entry would claim a tree that is not the issue's.
async function is_refused(
	request: EntryRequest,
	ports: RootPorts = live_ports(),
): Promise<boolean> {
	if (
		!is_handoff_child(ports.environment) ||
		request.command === run_stage.KICKOFF ||
		(await is_own_tree(request.issue_number, ports))
	) {
		return false
	}

	console.error(refusal_text(request, ports.cwd))

	return true
}

const run_entry_handoff_root = { is_refused }

export type { RootPorts }
export { run_entry_handoff_root }
