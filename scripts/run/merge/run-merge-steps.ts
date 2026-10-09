import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_followup_issue_close } from '#scripts/followup/git-followup-issue-close'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_cite } from '#scripts/issue/issue-cite'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_reap } from '#scripts/lane/lane-reap'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { poll } from '#scripts/lib/poll'
import {
	run_carry,
	type CarryChange,
	type CarryOwner,
	type RunCarry,
} from '#scripts/run/carry/run-carry'
import { run_carry_conversation } from '#scripts/run/carry/run-carry-conversation'
import { run_cut, type RunCut } from '#scripts/run/cut/run-cut'
import { run_merge } from './run-merge'

// The result of attempting to apply a carry change. Distinguishing `refused` from `applied` lets
// callers surface the refusal as a hard failure rather than silently continuing on a carry that was
// not advanced.
type ApplyCarryResult =
	{ kind: 'applied'; carry: RunCarry } | { kind: 'refused'; carry: RunCarry } | { kind: 'none' }

// The side-effect half of `run:merge`. The pure decisions are `run-merge.ts`'s; this file is what
// those decisions drive, collapsed into one command.
//
// **A separate `pnpm josh` command stays one.** `main:sync`, `lane:close`, `cost` and
// `epic:next` / `backlog:next` are run as captured subprocesses, so their output lands in this
// command's own return value rather than on the caller's stdout and their report logic is reused
// rather than cloned. The rest — counting the outcome into the single-source carry record, parking
// a failed child, and generating the progress comment from that record — is in-process, because it has
// a reusable logic function and no stdout to keep clean.

const OVER = 'over'
const LANES = '--lanes'
const REPO_FLAG = '--repo'
const LANE_CLOSE_OCCASION = 'lane close'
const GIT_ENTRY = '.git'
const MERGE_CLOSER = 'pnpm josh run:merge'
const SINGLE_READ = { attempts: 1, interval_ms: 0 }
const OPEN_STATE = 'OPEN'
const SYNC_RETRY = { attempts: 3, interval_ms: 5000 }
// What the driver judged when it parks a child, stated on the issue.
const FAILED_CAUSE = 'the child’s session ended with its issue still open and unfinished.'
const CUT_RELAUNCH_CAUSE =
	'its lane held a declared cut, but no successor could be relaunched from it (or it already was once).'

// One returned child's context, gathered from the command line by the CLI.
interface MergeContext {
	child: string
	epic: string | undefined
	repo: string | undefined
	// The hand-off threshold, or `undefined` where no AI session owns the loop — the supervisor's
	// `backlog:drive` has no context to cut, so a merge there is never handed back as `over`.
	over: number | undefined
	owner: CarryOwner
	// The child's transcript output path, when the caller passed `--output`. Read to tell an API-outage
	// ending apart from a genuine child failure; absent leaves outage detection off, so the child is
	// classified from its GitHub state alone.
	output?: string | undefined
	// The merged pull request that closes the child, when GitHub left the child OPEN after the merge —
	// the one `merged` child whose issue this command still has to close.
	merged_pr?: string | undefined
}

interface FailedResult {
	carry: RunCarry | undefined
	is_parked: boolean
	// Set when the carry record refused the count because this session is not its owner. The caller
	// surfaces this as a hard failure rather than continuing.
	is_refused: boolean
	// The open `blocked-by` blockers the child was released to wait on, cited — empty for a child that
	// was parked (or refused) instead.
	blockers: ReadonlyArray<string>
}

const NO_BLOCKERS: ReadonlyArray<string> = []

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
// skipped.
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

	const owned = run_carry_conversation.reclaim_owner(record.carry, ctx.owner)

	return { kind: 'applied', carry: run_carry.apply_change(record.target, owned, change) }
}

// The carry record when this session may not act on it — the same ownership guard `apply_carry` asks —
// or `undefined`. Asked before an action that counts nothing, like the cut fallback's relaunch, so a
// stray session is refused rather than relaunching a lane it does not own.
async function refused_carry(ctx: MergeContext): Promise<RunCarry | undefined> {
	const record = await read_record()

	if (record === undefined || !run_carry.is_count_refused(record.carry, ctx.owner)) return undefined

	return record.carry
}

// **A failed `main:sync` is retried before it ends the run**: a sync right after a merge can fail
// transiently while several lanes merge at once. **The error carries the step's stderr, not its
// stdout**: `main:sync` reports git's refusal on stderr, while stdout carries the wrapper's guard
// statistics.
async function sync_main(): Promise<void> {
	// `poll_until` answers only whether it succeeded, so the last attempt's stderr is kept here.
	let error_output = ''

	const is_synced = await poll.poll_until(
		async () => {
			const result = await josh(['main:sync'])

			error_output = result.err ?? ''

			return result.code === 0
		},
		{ ...SYNC_RETRY, sleeper: poll.sleep },
	)

	if (!is_synced) throw new Error(`main:sync failed: ${error_output}`)
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

// Stash whatever the lane still holds uncommitted before its tree is removed: `lane:close` deletes by
// force, and a merged child's uncommitted work may exist nowhere else. The stash stack outlives the
// tree, so the push is the copy. Returns whether closing is safe — `false` when the tree could not be
// read or pushed, so it is left rather than lost. A directory with no `.git` is no work tree — the
// remnant of an interrupted close — and holds nothing git could keep, so it is closed rather than
// stranded behind a status that fails.
async function preserve_uncommitted(child: string): Promise<boolean> {
	const lane = await lane_close.resolve_lane(child)
	const { directory } = lane.targets

	if (!existsSync(path.join(directory, GIT_ENTRY))) return true

	try {
		if (await git_stash.has_changes(directory)) await stash_work(child, directory)

		return true
	} catch {
		console.error(
			`${session_cite.issue(child)}: uncommitted work could not be stashed — lane left at ${directory}`,
		)

		return false
	}
}

function kept_lane_comment(directory: string): string {
	return `The split left this issue's lane open: it still holds a commit, an uncommitted change or a live process — ${directory}`
}

// A child promoted to an epic by a split leaves its lane holding a seat: the epic root is never
// dispatched again, so nothing else would ever close it. The lane is closed only when it holds
// nothing — no commit, no change, no live process (`lane_vacant`); any other lane is kept, and why is
// stated on the issue.
async function close_split_lane(child: string): Promise<void> {
	const lane = await lane_registry.find_open_lane(child)

	if (lane === undefined) return

	if (await lane_vacant.is_vacant(lane)) {
		await close_lane(child)

		return
	}

	await git_gh_issue_write.issue_try_comment(child, kept_lane_comment(lane.directory))
}

// The progress comment is a human-readable mirror of the carry record, so it is best-effort and only
// where a named epic has a body to carry it — a pure backlog run keeps the record alone.
async function post_counters(ctx: MergeContext, carry: RunCarry | undefined): Promise<void> {
	if (carry === undefined || ctx.epic === undefined) return

	await git_gh_issue_write.issue_try_comment(ctx.epic, run_merge.counters_comment(carry))
}

// A child merged while GitHub left it OPEN is closed here, through the one close `followup` uses
// The state was just read OPEN, so it is read once rather than waited on. A
// close that fails is reported with its recovery and does not undo the merge being counted.
async function close_merged_open(ctx: MergeContext): Promise<void> {
	if (ctx.merged_pr === undefined) return

	try {
		await git_followup_issue_close.ensure_issue_closed(
			{ issue_number: ctx.child, pr_url: ctx.merged_pr, closer: MERGE_CLOSER },
			SINGLE_READ,
		)
	} catch {
		console.error(
			`${session_cite.issue(ctx.child)}: could not be closed — ${git_followup_issue_close.CLOSE_RECOVERY}`,
		)
	}
}

// A merged child: count the merge (which resets the failure streak), return to the default branch,
// stash any uncommitted work the lane still holds and close it, and mirror the counters onto the epic. Returns the carry when the ownership check
// fails — the caller treats a non-undefined return as a hard refusal and must not offer a next child.
// Returns `undefined` on success.
async function do_merged(ctx: MergeContext): Promise<RunCarry | undefined> {
	const refused = await refused_carry(ctx)

	if (refused !== undefined) return refused

	await close_merged_open(ctx)
	await sync_main()
	const result = await apply_carry(ctx, {
		...run_merge.change_of('merged'),
		merged_issue: Number(ctx.child),
	})

	if (result.kind === 'refused') return result.carry

	if (await preserve_uncommitted(ctx.child)) await close_lane(ctx.child)
	await post_counters(ctx, result.kind === 'applied' ? result.carry : undefined)

	return undefined
}

// A stale label removal must not fail the run, so a failed removal is swallowed.
async function remove_in_progress(child: string): Promise<void> {
	try {
		await git_gh_issue_write.issue_remove_label(child, IN_PROGRESS_LABEL)
	} catch {
		// A stale label may already be gone; a failed removal must not fail the run.
	}
}

function refused_result(carry: RunCarry): FailedResult {
	return { carry, is_parked: false, is_refused: true, blockers: NO_BLOCKERS }
}

// The child's open `blocked-by` blockers, cited. A read that fails answers none, so the child is
// parked — a relation nobody could read is never taken as a dependency.
async function open_blockers(child: string): Promise<ReadonlyArray<string>> {
	try {
		const references = await git_gh_command.issue_blocked_by_references(child, '')

		return references
			.filter((blocker) => blocker.state === OPEN_STATE)
			.map((blocker) => issue_cite.plain(blocker.number, blocker.repo))
	} catch {
		return NO_BLOCKERS
	}
}

// A child that ended unfinished while an open blocker it records still has to land first is waiting,
// not failed: nothing is counted and `needs-decision` is not applied — the
// order is already recorded, so there is nothing for a person to decide — and its stale `in-progress`
// is dropped so the offer hands it back on its own once the blockers merge. The ownership guard is
// still asked, so a session that does not own the run cannot release a child it never dispatched.
async function do_waiting(
	ctx: MergeContext,
	blockers: ReadonlyArray<string>,
): Promise<FailedResult> {
	const refused = await refused_carry(ctx)

	if (refused !== undefined) return refused_result(refused)

	lane_reap.reap_child(ctx.child)
	await remove_in_progress(ctx.child)
	await git_gh_issue_write.issue_try_comment(ctx.child, run_merge.waiting_comment(blockers))

	return { carry: undefined, is_parked: false, is_refused: false, blockers }
}

// A failed child: count the failure, end whatever of its process is still running (a child judged
// abandoned that hung on a wait loop would otherwise answer the pgrep liveness check `alive` for its
// issue number forever), drop the stale `in-progress`, and park it with `needs-decision` so the next
// offer does not hand the same child straight back. Returns the record so the caller can read the
// streak against the guard. Returns `is_refused: true` without touching labels when the carry record
// rejected the count. A park is always explained on the issue — `cause` says what was judged, and the
// comment what was read and what a person does next.
async function park_failed(ctx: MergeContext, cause: string): Promise<FailedResult> {
	const result = await apply_carry(ctx, run_merge.change_of('failed'))

	if (result.kind === 'refused') return refused_result(result.carry)

	const carry = result.kind === 'applied' ? result.carry : undefined

	lane_reap.reap_child(ctx.child)
	await remove_in_progress(ctx.child)
	const is_parked = await git_gh_issue_write.issue_add_label(ctx.child, NEEDS_DECISION_LABEL)

	if (is_parked) {
		const reason = { child: ctx.child, cause, carry, output: ctx.output }

		await git_gh_issue_write.issue_try_comment(ctx.child, run_merge.park_comment(reason))
	}

	return { carry, is_parked, is_refused: false, blockers: NO_BLOCKERS }
}

// A child that ended unfinished: waiting when it records an open blocker (`do_waiting`), parked
// otherwise (`park_failed`) — an order already recorded is never a decision for a person.
async function do_failed(ctx: MergeContext, cause: string = FAILED_CAUSE): Promise<FailedResult> {
	const blockers = await open_blockers(ctx.child)

	if (blockers.length > 0) return await do_waiting(ctx, blockers)

	return await park_failed(ctx, cause)
}

// The outcome of counting an outage: the record to read the streak against, and whether the count was
// refused because this session does not own the budget.
interface OutageResult {
	carry: RunCarry | undefined
	is_refused: boolean
}

// An API-outage child: count the outage into its own streak, end any process it left — before the
// re-dispatch launches a second one matching the same pattern — and drop the stale `in-progress` so the
// child is offerable again, but **do not** park it with `needs-decision` — the environment failed, not
// the child, so it is re-dispatchable in the same run. Returns the record so the caller can read the
// outage streak against its guard. Returns `is_refused: true` without touching labels when the carry
// record rejected the count.
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

// The lane's cut the fallback may relaunch, or `undefined`. An OpenAI lane is left out: its
// supervisor, not this command, starts the process after a standing cut.
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

// **The cutting child launches its own successor; this is only the fallback**.
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
// is read as `over` — "could not measure" is never "still cheap". No threshold is no session to measure.
async function is_over_budget(over: number | undefined): Promise<boolean> {
	if (over === undefined) return false

	const result = await josh(['cost', '--over', String(over)])

	return result.code !== 0 || result.out === OVER
}

// The next offer: one issue number per line up to the free lanes, or a verdict token. `--lanes` needs
// `--repo`, so the epic form is used only where both are present.
async function ask_next(ctx: MergeContext): Promise<string> {
	if (ctx.epic === undefined || ctx.repo === undefined) {
		const backlog = await josh(['backlog:next'])

		return backlog.out
	}

	const offer = await josh(['epic:next', ctx.epic, REPO_FLAG, ctx.repo, LANES])

	return offer.out
}

const run_merge_steps = {
	CUT_RELAUNCH_CAUSE,
	ask_next,
	close_split_lane,
	do_failed,
	do_merged,
	do_outage,
	has_resumable_cut,
	is_over_budget,
	refused_carry,
	remove_in_progress,
	resume_cut,
}

export type { FailedResult, MergeContext, OutageResult }
export { run_merge_steps }
