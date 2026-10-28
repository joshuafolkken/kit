import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { core_budget } from '#scripts/gate/core-budget'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { test_pinned_ledger } from '#scripts/test/test-pinned-ledger'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_steps } from './run-review-steps'

// The background `josh test:pinned` of `josh run:review` (joshuafolkken/kit#4770): launched beside the
// gate and the brief, and waited on at `--join`. Run as its own `josh` command, it reserves its own
// cores (`DIRECT_UNIT_CLAIM`), so it shares the budget with the gate's units rather than overrunning it.
//
// **Two records, both keyed to the checkout.** The check writes its answer under the launch's token
// (`test-pinned-record.ts`); the start writes the launched pid and that token here, with the
// `--unpinned-ok` reason the join judges the answer by (joshuafolkken/kit#4793). No pid means no check
// was launched, and a pid that is gone without an answer is a check that died, which fails open the way
// a check that could not run does.

const PINNED_COMMAND = 'test:pinned'
const LAUNCH_PREFIX = 'josh-run-review-pinned-launch-'
const LOG_PREFIX = 'josh-run-review-pinned-log-'
const MS_PER_SECOND = 1000
const LOST_NOTE = 'its process ended without an answer'
const STOP_SIGNAL = 'SIGTERM'

// The join waits here only once the gate has settled and the review has returned, so the grace is
// counted from the end of the pair (joshuafolkken/kit#4794). A check still queued for its cores gets no
// grace at all (joshuafolkken/kit#4808): it could not finish within it. **Where a read follows, neither
// is stopped** (joshuafolkken/kit#4888): the check keeps running on the tree the join read, and the note
// names the one command that waits for its answer, so no lane runs `test:pinned` again by hand. Where
// none follows, the late check is stopped rather than left holding cores.
const GRACE_MS = 120_000
const READ_COMMAND = 'pnpm josh run:review --pinned'
const STILL_RUNNING_NOTE = `it is still running on this tree; wait for its answer with \`${READ_COMMAND}\` (a lane child: the ship's pre-detach reads it)`
const TIMED_OUT_NOTE = `no answer within ${String(GRACE_MS / MS_PER_SECOND)}s of the gate and the review`
const QUEUED_NOTE = 'it was still waiting for cores when the gate and the review ended'
// A round 1 with fixes to make moves the tree, and the round's `josh review:record` starts the check
// again on the fixed one — a lane child runs no `josh check:related` after the fixes
// (joshuafolkken/kit#4983) — so the join waits no grace on this tree's (joshuafolkken/kit#4895).
const FIXING_NOTE =
	"round 1 has fixes to make — it is left running, and the round's `josh review:record` starts it again on the fixed tree for the ship's pre-detach to read"
// `josh run:review --pinned` reads a check `josh review:record` started seconds before
// (joshuafolkken/kit#4834), so it waits through the core queue and the whole run; the bound only
// stops a check that hung.
const ALONE_GRACE_MS = 900_000
const ALONE_TIMED_OUT_NOTE = `no answer within ${String(ALONE_GRACE_MS / MS_PER_SECOND)}s of the read`

type Clock = () => number

// `start` is the launched pid's start time, so a pid the OS has since reissued is told apart from the
// check (joshuafolkken/kit#4828). `tree` is the digest of the tree it checks (`run-review-pinned-tree.ts`),
// so `josh review:record` tells a round-1 fix that moved the tree (joshuafolkken/kit#4834).
// `launched_at` is the launch's epoch milliseconds, the start of a stopped check's wall time.
interface Launch {
	pid: number
	token: string
	reason?: string | undefined
	start?: string | undefined
	tree?: string | undefined
	launched_at?: number | undefined
}

function launch_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(LAUNCH_PREFIX, root)
}

function log_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(LOG_PREFIX, root, '.log')
}

// The token ties the answer to this launch (`test-pinned-record.ts`).
function launch(root: string = PROJECT_ROOT, reason?: string, tree?: string): LaunchResult {
	const token = randomUUID()
	const argv = test_pinned_record.launch_argv(token, reason, test_pinned_ledger.BACKGROUND_ORIGIN)
	const launched = run_review_steps.launch_josh(argv, log_path(root), root)

	if (launched.kind === 'launched') {
		const { pid } = launched

		stamp_file.write_stamp(launch_path(root), {
			pid,
			token,
			reason,
			start: process_identity.read_start(pid),
			tree,
			launched_at: Date.now(),
		})
	}

	return launched
}

function optional_text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function to_launch(value: unknown): Launch | undefined {
	const { pid, token, reason, start, tree, launched_at } = value as Record<string, unknown>
	if (typeof pid !== 'number' || typeof token !== 'string') return undefined

	return {
		pid,
		token,
		reason: optional_text(reason),
		start: optional_text(start),
		tree: optional_text(tree),
		launched_at: typeof launched_at === 'number' ? launched_at : undefined,
	}
}

function read_launch(root: string): Launch | undefined {
	const raw = stamp_file.read_stamp_text(launch_path(root))

	if (raw === undefined) return undefined

	try {
		return to_launch(JSON.parse(raw))
	} catch {
		return undefined
	}
}

// One read: the answer, `undefined` while the check is still running, or a not-run answer once its
// process is gone without one. The record is read again after the pid is found gone, because the
// check writes its answer before it exits.
function read_answer(root: string, { pid, token, start }: Launch): PinnedSummary | undefined {
	const summary = test_pinned_record.read(token, root)

	if (summary !== undefined) return summary
	if (process_identity.is_same_process(pid, start) !== false) return undefined

	return (
		test_pinned_record.read(token, root) ?? test_pinned_record.not_run_summary(new Error(LOST_NOTE))
	)
}

// The launch is detached, so its pid leads a process group holding the `josh` process and its Vitest
// workers; signalling the group stops them all, and `base-tree.ts` removes the trees they held.
function signal_group(pid: number): void {
	try {
		process.kill(-pid, STOP_SIGNAL)
	} catch {
		// It ended between the check and the signal; there is nothing left to stop.
	}
}

// **A check stopped while it runs is a discarded probe** (joshuafolkken/kit#5262): it writes no ledger
// row of its own, so the stop writes one with the wall time it ran. A launch stamped before
// `launched_at` has no wall time, and writes none.
function discard(launched: Launch): void {
	signal_group(launched.pid)
	if (launched.launched_at === undefined) return

	void test_pinned_ledger.record_discarded(Date.now() - launched.launched_at)
}

// A stale stamp can outlive its check by days, so the start signals only a pid whose start time
// matches the launch's: a reissued pid, or one whose start could not be read, may lead another
// lane's group.
function stop_last(launched: Launch): void {
	if (process_identity.is_same_process(launched.pid, launched.start) === true) discard(launched)
}

// The stamp a waiter just read is this pair's, minutes old, so the lone read and a supervised join
// signal any pid not proven gone: one whose start could not be read (no `/proc`, no `ps`) is the check
// they have just been waiting on.
function stop_current(launched: Launch): void {
	if (process_identity.is_same_process(launched.pid, launched.start) !== false) discard(launched)
}

// Every start stops the last pair's check and clears its records first, so a join never reads an
// earlier tree's answer and a reopened pair leaves no check running unowned (joshuafolkken/kit#4828).
function clear(root: string = PROJECT_ROOT): void {
	const last = read_launch(root)

	if (last !== undefined) {
		stop_last(last)
		test_pinned_record.clear(last.token, root)
	}

	stamp_file.remove_stamp(launch_path(root))
}

// The dispatcher's claim in the core ledger (`core-budget.ts`) carries `admitted_at` from the moment
// the check is granted its cores, before its script even boots, so a claim from this checkout not yet
// admitted is a check still queued. A check that claimed nothing (a parent held the cores) is not one.
function is_queued(root: string): boolean {
	return core_budget
		.live_reservations()
		.some(
			({ reservation }) =>
				reservation.command === PINNED_COMMAND &&
				reservation.checkout === root &&
				reservation.admitted_at === undefined,
		)
}

// A check given up on fails open and is stopped rather than left burning the cores.
function stopped(launched: Launch, note: string): PinnedSummary {
	stop_current(launched)

	return test_pinned_record.not_run_summary(new Error(note))
}

async function poll_within_grace(
	root: string,
	launched: Launch,
	now: Clock,
	grace_ms: number = GRACE_MS,
): Promise<PinnedSummary | undefined> {
	const started = now()
	let summary = read_answer(root, launched)

	while (summary === undefined && now() - started < grace_ms) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(run_review_steps.POLL_INTERVAL_MS)
		summary = read_answer(root, launched)
	}

	return summary
}

function given_up(launched: Launch, note: string, is_left_running: boolean): PinnedSummary {
	if (!is_left_running) return stopped(launched, note)

	return test_pinned_record.not_run_summary(new Error(`${note} — ${STILL_RUNNING_NOTE}`))
}

// The check usually settles while the review is still running; the grace only bounds the join's wait
// on one that fell far behind the pair while running its tests.
async function poll_answer(
	root: string,
	launched: Launch,
	now: Clock,
	is_left_running: boolean,
): Promise<PinnedSummary> {
	const summary = read_answer(root, launched)

	if (summary !== undefined) return summary
	if (is_queued(root)) return given_up(launched, QUEUED_NOTE, is_left_running)
	const late = await poll_within_grace(root, launched, now)

	return late ?? given_up(launched, TIMED_OUT_NOTE, is_left_running)
}

// The `--unpinned-ok` reason the last check was launched with; `undefined` when it carried none.
function launched_reason(root: string = PROJECT_ROOT): string | undefined {
	return read_launch(root)?.reason
}

// A reason given after the check ended (joshuafolkken/kit#4920) goes on its launch record, so a later
// restart on a moved tree carries it as a launch's own reason does.
function carry_reason(reason: string, root: string = PROJECT_ROOT): void {
	const launched = read_launch(root)

	if (launched !== undefined) stamp_file.write_stamp(launch_path(root), { ...launched, reason })
}

// The tree the last check was launched on; `undefined` when none was, or its tree could not be read.
function launched_tree(root: string = PROJECT_ROOT): string | undefined {
	return read_launch(root)?.tree
}

// `undefined` when no check was launched. `is_left_running` is false where nothing reads a late answer.
async function wait_for_answer(
	root: string = PROJECT_ROOT,
	now: Clock = () => Date.now(),
	is_left_running = true,
): Promise<PinnedSummary | undefined> {
	const launched = read_launch(root)

	if (launched === undefined) return undefined

	return await poll_answer(root, launched, now, is_left_running)
}

// The answer as it stands, waiting nothing and stopping nothing; `undefined` when no check was launched.
// A check still running answers with `pending_note`, why it was not waited on.
function answer_now(
	root: string = PROJECT_ROOT,
	pending_note: string = FIXING_NOTE,
): PinnedSummary | undefined {
	const launched = read_launch(root)

	if (launched === undefined) return undefined

	return read_answer(root, launched) ?? test_pinned_record.not_run_summary(new Error(pending_note))
}

// Whether the last check left its answer, rather than ending without one or never being launched.
function is_answered(root: string = PROJECT_ROOT): boolean {
	const launched = read_launch(root)

	return launched !== undefined && test_pinned_record.read(launched.token, root) !== undefined
}

// Whether a check was launched and has no answer yet: still running, rather than done or lost.
function is_pending(root: string = PROJECT_ROOT): boolean {
	const launched = read_launch(root)

	return launched !== undefined && read_answer(root, launched) === undefined
}

// Whether the last check's process is proven to be the one launched, as `stop_last` asks before it
// signals: a stale stamp's reissued or unreadable pid is not waited on.
function is_live(root: string = PROJECT_ROOT): boolean {
	const launched = read_launch(root)

	return (
		launched !== undefined &&
		process_identity.is_same_process(launched.pid, launched.start) === true
	)
}

// The lone read's wait: a queued check is waited on, not stopped. `undefined` when no check was launched.
async function wait_alone(
	root: string = PROJECT_ROOT,
	now: Clock = () => Date.now(),
): Promise<PinnedSummary | undefined> {
	const launched = read_launch(root)

	if (launched === undefined) return undefined
	const summary = await poll_within_grace(root, launched, now, ALONE_GRACE_MS)

	return summary ?? stopped(launched, ALONE_TIMED_OUT_NOTE)
}

const run_review_pinned_steps = {
	FIXING_NOTE,
	answer_now,
	carry_reason,
	clear,
	is_answered,
	is_live,
	is_pending,
	launch,
	launched_reason,
	launched_tree,
	log_path,
	wait_alone,
	wait_for_answer,
}

export { run_review_pinned_steps }
