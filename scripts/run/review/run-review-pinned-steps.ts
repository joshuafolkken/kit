import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { core_budget } from '#scripts/gate/core-budget'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { LaunchResult } from '#scripts/run/detached-launch'
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
const RECORD_FLAG = '--record'
const LAUNCH_PREFIX = 'josh-run-review-pinned-launch-'
const LOG_PREFIX = 'josh-run-review-pinned-log-'
const MS_PER_SECOND = 1000
const LOST_NOTE = 'its process ended without an answer'
const STOP_SIGNAL = 'SIGTERM'

// The join waits here only once the gate has settled and the review has returned, so the grace is
// counted from the end of the pair (joshuafolkken/kit#4794). A check this far behind it is one the
// CPU starved, and a longer wait would end in the same not-run answer, minutes later. A check still
// queued for its cores gets no grace at all (joshuafolkken/kit#4808): it could not finish within it.
const GRACE_MS = 120_000
const TIMED_OUT_NOTE = `no answer within ${String(GRACE_MS / MS_PER_SECOND)}s of the gate and the review`
const QUEUED_NOTE = 'it was still waiting for cores when the gate and the review ended'
// `josh run:review --pinned` reads a check `josh review:record` started seconds before
// (joshuafolkken/kit#4834), so it waits through the core queue and the whole run; the bound only
// stops a check that hung.
const ALONE_GRACE_MS = 900_000
const ALONE_TIMED_OUT_NOTE = `no answer within ${String(ALONE_GRACE_MS / MS_PER_SECOND)}s of the read`

type Clock = () => number

// `start` is the launched pid's start time, so a pid the OS has since reissued is told apart from the
// check (joshuafolkken/kit#4828). `tree` is the digest of the tree it checks (`run-review-pinned-tree.ts`),
// so `josh review:record` tells a round-1 fix that moved the tree (joshuafolkken/kit#4834).
interface Launch {
	pid: number
	token: string
	reason?: string | undefined
	start?: string | undefined
	tree?: string | undefined
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
	const argv = [PINNED_COMMAND, RECORD_FLAG, token]
	const launched = run_review_steps.launch_josh(argv, log_path(root), root)

	if (launched.kind === 'launched') {
		const { pid } = launched

		stamp_file.write_stamp(launch_path(root), {
			pid,
			token,
			reason,
			start: process_identity.read_start(pid),
			tree,
		})
	}

	return launched
}

function optional_text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function to_launch(value: unknown): Launch | undefined {
	const { pid, token, reason, start, tree } = value as Record<string, unknown>
	if (typeof pid !== 'number' || typeof token !== 'string') return undefined

	return {
		pid,
		token,
		reason: optional_text(reason),
		start: optional_text(start),
		tree: optional_text(tree),
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

// A stale stamp can outlive its check by days, so the start signals only a pid whose start time
// matches the launch's: a reissued pid, or one whose start could not be read, may lead another
// lane's group.
function stop_last({ pid, start }: Launch): void {
	if (process_identity.is_same_process(pid, start) === true) signal_group(pid)
}

// The join's stamp is this pair's, minutes old, so the join signals any pid not proven gone: one whose
// start could not be read (no `/proc`, no `ps`) is the check it has just been waiting on.
function stop_current({ pid, start }: Launch): void {
	if (process_identity.is_same_process(pid, start) !== false) signal_group(pid)
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

// The check usually settles while the review is still running; the grace only bounds one that fell
// far behind the pair while running its tests.
async function poll_answer(root: string, launched: Launch, now: Clock): Promise<PinnedSummary> {
	const summary = read_answer(root, launched)

	if (summary !== undefined) return summary
	if (is_queued(root)) return stopped(launched, QUEUED_NOTE)

	return (await poll_within_grace(root, launched, now)) ?? stopped(launched, TIMED_OUT_NOTE)
}

// The `--unpinned-ok` reason the last check was launched with; `undefined` when it carried none.
function launched_reason(root: string = PROJECT_ROOT): string | undefined {
	return read_launch(root)?.reason
}

// The tree the last check was launched on; `undefined` when none was, or its tree could not be read.
function launched_tree(root: string = PROJECT_ROOT): string | undefined {
	return read_launch(root)?.tree
}

// `undefined` when no check was launched.
async function wait_for_answer(
	root: string = PROJECT_ROOT,
	now: Clock = () => Date.now(),
): Promise<PinnedSummary | undefined> {
	const launched = read_launch(root)

	if (launched === undefined) return undefined

	return await poll_answer(root, launched, now)
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
	clear,
	launch,
	launched_reason,
	launched_tree,
	log_path,
	wait_alone,
	wait_for_answer,
}

export { run_review_pinned_steps }
