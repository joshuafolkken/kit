import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { PullMergeState } from '#scripts/gh/git-gh-pr-read'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_halfrun_resume, type StopMark } from './run-halfrun-resume'

// A `prrun` stops at a green, mergeable pull request and **keeps** its hold, so
// a person can look before anything merges. What comes next is one of three, and `run:entry` answers
// which as the resume token `fullrun #N` acts on — read, never inferred:
//
// - `prrun-merged` — the person merged it by hand. Only `followup`'s tail is left.
// - `prrun-merge` — the branch is where the stop left it, both here and on the pull request, and the
//   tree is clean. What was verified is what would merge, so `followup` merges without the gate and
//   the review again.
// - `prrun-gate` — the branch moved since the stop, or the tree is dirty: a person changed something,
//   so the gate and the review run again before `followup`. **The pull request's own head is asked
//   too**: a commit pushed on GitHub (a suggestion applied, "Update branch") moves only the remote,
//   and `followup` merges the remote — an unread or moved one is never taken as untouched.
//
// **Only a marked record is adopted**, as for the `halfrun` stop (`run-halfrun-resume.ts`): the stop
// writes the commit it stopped on (`run:hold <N> --prrun-stop`), and a hold without it is a run still
// working, never one waiting for a person.

const PRRUN_MERGED = 'prrun-merged'
const PRRUN_MERGE = 'prrun-merge'
const PRRUN_GATE = 'prrun-gate'

type PrrunToken = typeof PRRUN_GATE | typeof PRRUN_MERGE | typeof PRRUN_MERGED

interface ResumeFacts {
	is_merged: boolean
	stop_head: string
	head: string
	// The commit the pull request's head is on, or `undefined` when it could not be read.
	pr_head: string | undefined
	is_dirty: boolean
}

function is_untouched(facts: ResumeFacts): boolean {
	return facts.head === facts.stop_head && facts.pr_head === facts.stop_head && !facts.is_dirty
}

function decide(facts: ResumeFacts): PrrunToken {
	if (facts.is_merged) return PRRUN_MERGED

	return is_untouched(facts) ? PRRUN_MERGE : PRRUN_GATE
}

function stop_head_of(read: HoldRead, issue: string): string | undefined {
	const hold = run_halfrun_resume.hold_of(read)

	return hold?.issue === issue ? hold.prrun_stop_head : undefined
}

async function read_merge_state(): Promise<PullMergeState | undefined> {
	return await git_gh_command.pr_get_merge_state(await git_branch.current())
}

async function read_facts(stop_head: string): Promise<ResumeFacts> {
	const [state, head, is_dirty] = await Promise.all([
		read_merge_state(),
		git_command.head_commit(),
		run_hold.is_tree_dirty(),
	])

	return {
		is_merged: state?.is_merged === true,
		stop_head,
		head,
		pr_head: state?.head_sha,
		is_dirty,
	}
}

// Read-only, so `run:entry` can ask the session budget before it takes anything over. `undefined` is
// "no `prrun` stop for this issue here", and the ordinary claim decides the tree.
async function resume_token(issue: string): Promise<PrrunToken | undefined> {
	const target = await run_halfrun_resume.hold_target()

	if (target === undefined) return undefined

	const stop_head = stop_head_of(run_hold.read_hold(target), issue)

	return stop_head === undefined ? undefined : decide(await read_facts(stop_head))
}

async function adopt(issue: string): Promise<boolean> {
	const target = await run_halfrun_resume.hold_target()

	if (target === undefined || stop_head_of(run_hold.read_hold(target), issue) === undefined) {
		return false
	}

	return run_halfrun_resume.take_over(target, issue)
}

// The `--prrun-stop` mark: the run's own record re-written with the commit the pull request is on.
async function mark_stop_at(target: string, issue: string): Promise<StopMark> {
	const head = await git_command.head_commit()

	return run_halfrun_resume.mark_stop_at(target, issue, { prrun_stop_head: head })
}

const run_prrun_resume = {
	PRRUN_GATE,
	PRRUN_MERGE,
	PRRUN_MERGED,
	adopt,
	decide,
	mark_stop_at,
	resume_token,
	stop_head_of,
}

export type { PrrunToken, ResumeFacts }
export { run_prrun_resume }
