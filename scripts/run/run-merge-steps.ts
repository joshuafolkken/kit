import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { execa } from 'execa'
import { run_carry, type CarryChange, type CarryOwner, type RunCarry } from './run-carry'
import { run_merge } from './run-merge'

// The side-effect half of `run:merge` (joshuafolkken/kit#2024). The pure decisions are `run-merge.ts`'s;
// this file is what those decisions drive — the same actions the parent used to spend two turns on,
// collapsed into one command.
//
// **What was a separate `pnpm josh` call stays one.** `main:sync`, `lane:close`, `cost` and
// `epic:next` / `backlog:next` are run as captured subprocesses, so their output lands in this
// command's own return value rather than on the caller's stdout and their report logic is reused
// rather than cloned. The new work — counting the outcome into the single-source carry record, parking
// a failed child, and generating the progress comment from that record — is in-process, because it has
// a reusable logic function and no stdout to keep clean.

const PNPM = 'pnpm'
const JOSH = 'josh'
const OVER = 'over'
const NONZERO_EXIT = 1
const LANES = '--lanes'
const REPO_FLAG = '--repo'

// One returned child's context, gathered from the command line by the CLI.
interface MergeContext {
	child: string
	epic: string | undefined
	repo: string | undefined
	over: number
	owner: CarryOwner
}

interface JoshResult {
	code: number
	out: string
}

// A captured `pnpm josh` subprocess: its output is read back rather than inherited, and a non-zero
// exit is a value to branch on rather than a throw (`reject: false`).
async function josh(args: ReadonlyArray<string>): Promise<JoshResult> {
	const result = await execa(PNPM, [JOSH, ...args], { reject: false })

	return { code: result.exitCode ?? NONZERO_EXIT, out: result.stdout.trim() }
}

// Read the single-source carry record, or `undefined` when there is none to advance.
async function read_record(): Promise<{ target: string; carry: RunCarry } | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	const target = run_carry.carry_path(directory)
	const read = run_carry.read_carry(target)

	if (read.kind !== 'carried' && read.kind !== 'expired') return undefined

	return { target, carry: read.carry }
}

// Count the outcome into the carry record, respecting the ownership guard so a session whose record
// was handed off cannot advance a budget that is no longer its own. Returns the record as it now
// stands — updated, or left as read when nothing was counted.
async function apply_carry(
	ctx: MergeContext,
	change: CarryChange | undefined,
): Promise<RunCarry | undefined> {
	const record = await read_record()

	if (record === undefined) return undefined

	if (change === undefined) return record.carry

	if (run_carry.is_count_refused(record.carry, ctx.owner)) return record.carry

	return run_carry.apply_change(record.target, record.carry, change)
}

async function sync_main(): Promise<void> {
	await josh(['main:sync'])
}

async function close_lane(child: string): Promise<void> {
	await josh(['lane:close', child])
}

// The progress comment is a human-readable mirror of the carry record, so it is best-effort and only
// where a named epic has a body to carry it — a pure backlog run keeps the record alone.
async function post_counters(ctx: MergeContext, carry: RunCarry | undefined): Promise<void> {
	if (carry === undefined) return

	if (ctx.epic === undefined) return

	await git_gh_issue_write.issue_try_comment(ctx.epic, run_merge.counters_comment(carry))
}

// A merged child: count the merge (which resets the failure streak), return to the default branch,
// close the lane, and mirror the counters onto the epic.
async function do_merged(ctx: MergeContext): Promise<void> {
	const carry = await apply_carry(ctx, run_merge.change_of('merged'))

	await sync_main()
	await close_lane(ctx.child)
	await post_counters(ctx, carry)
}

// A stale label removal must not fail the run, so a failed removal is swallowed exactly as the
// `|| true` in the hand-written procedure did.
async function remove_in_progress(child: string): Promise<void> {
	try {
		await git_gh_issue_write.issue_remove_label(child, IN_PROGRESS_LABEL)
	} catch {
		// A stale label may already be gone; a failed removal must not fail the run.
	}
}

// A failed child: count the failure, drop the stale `in-progress`, and park it with `needs-decision`
// so the next offer does not hand the same child straight back. Returns the record so the caller can
// read the streak against the guard.
async function do_failed(ctx: MergeContext): Promise<RunCarry | undefined> {
	const carry = await apply_carry(ctx, run_merge.change_of('failed'))

	await remove_in_progress(ctx.child)
	await git_gh_issue_write.issue_add_label(ctx.child, NEEDS_DECISION_LABEL)

	return carry
}

// The hand-off check, asked at a merge alone. A subprocess that cannot measure exits non-zero, which
// is read as `over` — "could not measure" is never "still cheap".
async function is_over_budget(over: number): Promise<boolean> {
	const result = await josh(['cost', '--over', String(over)])

	return result.code === 0 ? result.out === OVER : true
}

// The next offer: one issue number per line up to the free lanes, or a verdict token, exactly as the
// parent read it. `--lanes` needs `--repo`, so the epic form is used only where both are present.
async function ask_next(ctx: MergeContext): Promise<string> {
	if (ctx.epic === undefined || ctx.repo === undefined) {
		const backlog = await josh(['backlog:next'])

		return backlog.out
	}

	const offer = await josh(['epic:next', ctx.epic, REPO_FLAG, ctx.repo, LANES])

	return offer.out
}

const run_merge_steps = {
	apply_carry,
	ask_next,
	do_failed,
	do_merged,
	is_over_budget,
}

export type { MergeContext }
export { run_merge_steps }
