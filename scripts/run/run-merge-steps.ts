import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_carry, type CarryChange, type CarryOwner, type RunCarry } from './run-carry'
import { run_merge } from './run-merge'

// The result of attempting to apply a carry change. Distinguishing `refused` from `applied` lets
// callers surface the refusal as a hard failure rather than silently continuing on a carry that was
// not advanced (joshuafolkken/kit#2114).
type ApplyCarryResult =
	{ kind: 'applied'; carry: RunCarry } | { kind: 'refused'; carry: RunCarry } | { kind: 'none' }

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

const OVER = 'over'
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

interface FailedResult {
	carry: RunCarry | undefined
	is_parked: boolean
	// Set when the carry record refused the count because this session is not its owner
	// (joshuafolkken/kit#2114). The caller surfaces this as a hard failure rather than continuing.
	is_refused: boolean
}

// A captured `pnpm josh` subprocess: its output is read back rather than inherited, and a non-zero
// exit is a value to branch on rather than a throw. The step's stderr stays piped here — `run:merge`
// composes its own report from the captured values — so this passes `josh_command.josh_run`'s default.
async function josh(args: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(args)
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
// was handed off cannot advance a budget that is no longer its own. Returns `refused` when the
// ownership check fails — callers treat this as a hard failure so the operation is not silently
// skipped (joshuafolkken/kit#2114).
async function apply_carry(
	ctx: MergeContext,
	change: CarryChange | undefined,
): Promise<ApplyCarryResult> {
	const record = await read_record()

	if (record === undefined) return { kind: 'none' }

	if (change === undefined) return { kind: 'applied', carry: record.carry }

	if (run_carry.is_count_refused(record.carry, ctx.owner)) {
		return { kind: 'refused', carry: record.carry }
	}

	return { kind: 'applied', carry: run_carry.apply_change(record.target, record.carry, change) }
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
	if (carry === undefined || ctx.epic === undefined) return

	await git_gh_issue_write.issue_try_comment(ctx.epic, run_merge.counters_comment(carry))
}

// A merged child: count the merge (which resets the failure streak), return to the default branch,
// close the lane, and mirror the counters onto the epic. Returns the carry when the ownership check
// fails — the caller treats a non-undefined return as a hard refusal and must not offer a next child
// (joshuafolkken/kit#2114). Returns `undefined` on success.
async function do_merged(ctx: MergeContext): Promise<RunCarry | undefined> {
	const result = await apply_carry(ctx, run_merge.change_of('merged'))

	if (result.kind === 'refused') return result.carry

	await sync_main()
	await close_lane(ctx.child)
	await post_counters(ctx, result.kind === 'applied' ? result.carry : undefined)

	return undefined
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
// read the streak against the guard. Returns `is_refused: true` without touching labels when the
// carry record rejected the count (joshuafolkken/kit#2114).
async function do_failed(ctx: MergeContext): Promise<FailedResult> {
	const result = await apply_carry(ctx, run_merge.change_of('failed'))

	if (result.kind === 'refused') return { carry: result.carry, is_parked: false, is_refused: true }

	const carry = result.kind === 'applied' ? result.carry : undefined

	await remove_in_progress(ctx.child)
	const is_parked = await git_gh_issue_write.issue_add_label(ctx.child, NEEDS_DECISION_LABEL)

	return { carry, is_parked, is_refused: false }
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

export type { ApplyCarryResult, FailedResult, MergeContext }
export { run_merge_steps }
