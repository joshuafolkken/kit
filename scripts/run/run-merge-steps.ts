import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { git_stash } from '#scripts/git/git-stash'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_reap } from '#scripts/lane/lane-reap'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { run_carry, type CarryChange, type CarryOwner, type RunCarry } from './run-carry'
import { run_cut, type RunCut } from './run-cut'
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
const LANE_CLOSE_OCCASION = 'lane close'
const GIT_ENTRY = '.git'

// One returned child's context, gathered from the command line by the CLI.
interface MergeContext {
	child: string
	epic: string | undefined
	repo: string | undefined
	over: number
	owner: CarryOwner
	// The child's transcript output path, when the caller passed `--output`. Read to tell an API-outage
	// ending apart from a genuine child failure (joshuafolkken/kit#2240); absent leaves outage detection
	// off, so the child is classified from its GitHub state alone as before.
	output?: string | undefined
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

// The carry record when this session may not act on it — the same ownership guard `apply_carry` asks —
// or `undefined`. Asked before an action that counts nothing, like the cut fallback's relaunch, so a
// stray session is refused rather than relaunching a lane it does not own (joshuafolkken/kit#2484).
async function refused_carry(ctx: MergeContext): Promise<RunCarry | undefined> {
	const record = await read_record()

	if (record === undefined || !run_carry.is_count_refused(record.carry, ctx.owner)) return undefined

	return record.carry
}

async function sync_main(): Promise<void> {
	await josh(['main:sync'])
}

async function close_lane(child: string): Promise<void> {
	await josh(['lane:close', child])
}

function preserved_comment(message: string): string {
	return [
		'The lane held uncommitted work when `run:merge` closed it, so it was stashed before the close:',
		`- recover with \`pnpm josh stash:pop "${message}"\``,
	].join('\n')
}

async function stash_work(child: string, directory: string): Promise<void> {
	const message = git_stash.work_message(child, LANE_CLOSE_OCCASION)

	await git_stash.push(message, directory)
	await git_gh_issue_write.issue_try_comment(child, preserved_comment(message))
}

// Stash whatever the lane still holds uncommitted before its tree is removed (joshuafolkken/kit#2476):
// `lane:close` deletes by force, and a merged child that had popped its parked work and then read
// `already-done` left that work nowhere else. The stash stack outlives the tree, so the push is the copy.
// Returns whether closing is safe — `false` when the tree could not be read or pushed, so it is left
// rather than lost. A directory with no `.git` is no work tree — the remnant of an interrupted close —
// and holds nothing git could keep, so it is closed rather than stranded behind a status that fails.
async function preserve_uncommitted(child: string): Promise<boolean> {
	const lane = await lane_close.resolve_lane(child)
	const { directory } = lane.targets

	if (!existsSync(path.join(directory, GIT_ENTRY))) return true

	try {
		if (await git_stash.has_changes(directory)) await stash_work(child, directory)

		return true
	} catch {
		console.error(`#${child}: uncommitted work could not be stashed — lane left at ${directory}`)

		return false
	}
}

// The progress comment is a human-readable mirror of the carry record, so it is best-effort and only
// where a named epic has a body to carry it — a pure backlog run keeps the record alone.
async function post_counters(ctx: MergeContext, carry: RunCarry | undefined): Promise<void> {
	if (carry === undefined || ctx.epic === undefined) return

	await git_gh_issue_write.issue_try_comment(ctx.epic, run_merge.counters_comment(carry))
}

// A merged child: count the merge (which resets the failure streak), return to the default branch,
// stash any uncommitted work the lane still holds and close it, and mirror the counters onto the epic. Returns the carry when the ownership check
// fails — the caller treats a non-undefined return as a hard refusal and must not offer a next child
// (joshuafolkken/kit#2114). Returns `undefined` on success.
async function do_merged(ctx: MergeContext): Promise<RunCarry | undefined> {
	const result = await apply_carry(ctx, run_merge.change_of('merged'))

	if (result.kind === 'refused') return result.carry

	await sync_main()
	if (await preserve_uncommitted(ctx.child)) await close_lane(ctx.child)
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

// A failed child: count the failure, end whatever of its process is still running (a child judged
// abandoned that hung on a wait loop would otherwise answer the pgrep liveness check `alive` for its
// issue number forever, joshuafolkken/kit#2421), drop the stale `in-progress`, and park it with
// `needs-decision` so the next offer does not hand the same child straight back. Returns the record
// so the caller can read the streak against the guard. Returns `is_refused: true` without touching labels when the
// carry record rejected the count (joshuafolkken/kit#2114).
async function do_failed(ctx: MergeContext): Promise<FailedResult> {
	const result = await apply_carry(ctx, run_merge.change_of('failed'))

	if (result.kind === 'refused') return { carry: result.carry, is_parked: false, is_refused: true }

	const carry = result.kind === 'applied' ? result.carry : undefined

	lane_reap.reap_child(ctx.child)
	await remove_in_progress(ctx.child)
	const is_parked = await git_gh_issue_write.issue_add_label(ctx.child, NEEDS_DECISION_LABEL)

	return { carry, is_parked, is_refused: false }
}

// The outcome of counting an outage: the record to read the streak against, and whether the count was
// refused because this session does not own the budget (joshuafolkken/kit#2240).
interface OutageResult {
	carry: RunCarry | undefined
	is_refused: boolean
}

// An API-outage child: count the outage into its own streak, end any process it left — before the
// re-dispatch launches a second one matching the same pattern (joshuafolkken/kit#2421) — and drop the
// stale `in-progress` so the child is offerable again, but **do not** park it with `needs-decision` — the environment failed, not
// the child, so it is re-dispatchable in the same run (joshuafolkken/kit#2240). Returns the record so
// the caller can read the outage streak against its guard. Returns `is_refused: true` without touching
// labels when the carry record rejected the count (joshuafolkken/kit#2114).
async function do_outage(ctx: MergeContext): Promise<OutageResult> {
	const result = await apply_carry(ctx, run_merge.change_of('outage'))

	if (result.kind === 'refused') return { carry: result.carry, is_refused: true }

	lane_reap.reap_child(ctx.child)
	await remove_in_progress(ctx.child)

	return { carry: result.kind === 'applied' ? result.carry : undefined, is_refused: false }
}

interface RelaunchableCut {
	lane: LaneInfo
	target: string
	cut: RunCut
}

// The lane's cut the fallback may relaunch, or `undefined` (joshuafolkken/kit#2484). An OpenAI lane is
// left out: its supervisor, not this command, starts the process after a standing cut.
async function relaunchable_lane(child: string): Promise<LaneInfo | undefined> {
	const lane = await lane_registry.find_open_lane(child)

	return lane === undefined || lane_relaunch.is_openai_lane(lane) ? undefined : lane
}

async function relaunchable_cut(child: string): Promise<RelaunchableCut | undefined> {
	const lane = await relaunchable_lane(child)

	if (lane === undefined) return undefined

	const carried = run_cut.lane_cut_sync(lane.directory)

	if (carried === undefined || !run_cut.is_relaunchable(carried.cut, child)) return undefined

	return { lane, ...carried }
}

async function has_resumable_cut(child: string): Promise<boolean> {
	return (await relaunchable_cut(child)) !== undefined
}

// **The cutting child launches its own successor; this is only the fallback** (joshuafolkken/kit#2484).
// `lane:await` wakes the parent once every process of the lane has gone, so a cut still unadopted then
// means the successor never took it over. It is relaunched through the same `lane_relaunch` the cut uses,
// once per cut — the record is marked first, so a second unadopted return is parked instead. Returns
// whether a successor was started.
async function resume_cut(child: string): Promise<boolean> {
	const found = await relaunchable_cut(child)

	if (found === undefined || !run_cut.mark_merge_relaunched(found.target, found.cut)) return false

	const result = lane_relaunch.resume(found.lane, found.cut.phase, (note) => {
		console.error(note)
	})

	return result.kind === 'launched'
}

// The hand-off check, asked at a merge alone. A subprocess that cannot measure exits non-zero, which
// is read as `over` — "could not measure" is never "still cheap".
async function is_over_budget(over: number): Promise<boolean> {
	const result = await josh(['cost', '--over', String(over)])

	return result.code !== 0 || result.out === OVER
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
	do_outage,
	has_resumable_cut,
	is_over_budget,
	refused_carry,
	resume_cut,
}

export type { MergeContext, OutageResult }
export { run_merge_steps }
