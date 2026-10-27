import { randomUUID } from 'node:crypto'
import { check_reuse } from '#scripts/gate/check-reuse'
import type { JoshResult } from '#scripts/josh/josh-run'
import { buffered_process } from '#scripts/lib/buffered-process'
import { error_text } from '#scripts/lib/error-message'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'
import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_ship_pre_detach, type PreDetachResult } from './run-ship-pre-detach'
import type { ShipArguments } from './run-ship-steps'

// `josh test:pinned` among the pre-detach checks of a `josh ship --review` (joshuafolkken/kit#4785). The
// child's `run:review` checked the tree it saw; a round-1 fix made after it reached no `test:pinned`
// until the supervisor's review stage stopped on it, after the detach. Here it stops in the
// foreground, with the text and the `--unpinned-ok` judgment `run:review --join` uses
// (`run-review-pinned.ts`).
//
// **On the tree `run:review` checked it runs no `test:pinned`**: it reads that background check's
// answer (`run-review-pinned-join.ts`). On another tree it waits that check out, so its verdicts
// reach the cache (joshuafolkken/kit#4895), then runs its own as a `josh` command, so it reserves its
// own cores (`DIRECT_UNIT_CLAIM`) beside the other checks, and it probes only the hunks whose stored
// verdict the per-checkout cache no longer holds (`test-pinned-cache-logic.ts`). Its answer comes
// back through the record `--record` leaves (`test-pinned-record.ts`). Under
// `--unpinned-ok "<reason>"` — given, or carried from this branch's record (`with_recorded_reason`) —
// it runs only when the supervisor reuses round 1 (`pinned_check`).
// Without `--review` nothing after the detach asks `test:pinned`, and `--unpinned-ok` is refused there
// (`run-ship-args.ts`), so the check is not asked.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const SKIPPED_NOTE =
	'test:pinned not run before the detach; round 1 lists the unpinned places under --unpinned-ok: '
const CARRIED_NOTE = 'josh ship: --unpinned-ok carried from an earlier run on this branch: '

type CheckOptions = Pick<ShipArguments, 'number' | 'unpinned_ok'>
type PinnedOptions = CheckOptions & Pick<ShipArguments, 'is_review'>

// A check that left no answer could not run, and fails open as the one `run:review` launches does.
// Its arguments follow the reason (`test_pinned_record.launch_argv`).
async function own_summary(reason: string | undefined): Promise<PinnedSummary> {
	const token = randomUUID()
	const argv = ['josh', ...test_pinned_record.launch_argv(token, reason, 'pre-detach')]
	const result = await buffered_process.run_buffered_process(argv)
	const answer = test_pinned_record.read(token)

	test_pinned_record.clear(token)

	return answer ?? test_pinned_record.not_run_summary(result.output)
}

// **The tree `run:review` checked is not checked twice** (joshuafolkken/kit#4888): its background
// check's answer is read, waited for while it still runs; only another tree, or a check that left no
// answer, runs one here. **A reason never judges a check that stopped at its first unpinned hunk**
// (joshuafolkken/kit#5153): the hunks it left are probed here before the reason accepts the list.
async function summary(reason: string | undefined): Promise<PinnedSummary> {
	const answer = await run_review_pinned_join.answer_on_tree()
	const is_whole = answer?.is_cut !== true || reason === undefined

	return answer !== undefined && is_whole ? answer : await own_summary(reason)
}

// The verdicts an earlier probe left for this very tree, read from the cache without a probe
// (joshuafolkken/kit#5078); `undefined` when a hunk moved since, or the tree could not be read.
async function held_summary(): Promise<PinnedSummary | undefined> {
	try {
		const report = await test_pinned.held_report(test_pinned_logic.DEFAULT_MAX_HUNKS)

		return report === undefined ? undefined : test_pinned_record.summary_of(report)
	} catch (error) {
		error_text.trace_swallowed('run_ship_pre_detach_pinned.held_summary', error)

		return undefined
	}
}

// **A re-ship with a new reason probes nothing the cache already answers** (joshuafolkken/kit#5078):
// the earlier probe's verdicts are judged under the reason, with no wait on a check elsewhere. A moved
// hunk falls to `summary`, whose run probes only the hunks the cache no longer holds.
async function summary_for(reason: string | undefined): Promise<PinnedSummary> {
	const held = reason === undefined ? undefined : await held_summary()

	return held ?? (await summary(reason))
}

// Whether the supervisor runs a fresh round 1, whose `run:review --join` lists and records the unpinned
// places under the reason. A reused round 1 — its delta left to round 2, or after the ship's own
// round 1 stopped, the lane's fix included — runs no `test:pinned` (`review-round-reuse.ts`). A question git could not answer probes.
async function is_listed_after_detach(number: string): Promise<boolean> {
	try {
		return !(await review_round_reuse.is_reusable_here(Number(number)))
	} catch (error) {
		error_text.trace_swallowed('run_ship_pre_detach_pinned.is_listed_after_detach', error)

		return false
	}
}

// **A reason accepts any answer, so no probe is waited on** (joshuafolkken/kit#4833) when a fresh
// round 1 lists the places after the detach.
async function pinned_check(options: CheckOptions): Promise<JoshResult> {
	const reason = run_review_pinned.ok_reason_of(options.unpinned_ok)

	if (reason !== undefined && (await is_listed_after_detach(options.number))) {
		return { code: SUCCESS_EXIT_CODE, out: `${SKIPPED_NOTE}${reason}\n` }
	}

	const verdict = await run_review_pinned_accepted.judge(await summary_for(reason), reason)

	return {
		code: verdict.kind === 'stop' ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE,
		out: verdict.text,
	}
}

// The pre-detach checks this ship runs, `test:pinned` among them under `--review`.
function checks_for(options: PinnedOptions): () => Promise<PreDetachResult> {
	if (!options.is_review) return async () => await run_ship_pre_detach.checks()

	return async () =>
		await run_ship_pre_detach.checks(process.cwd(), check_reuse.DEFAULT_RECORDS, async () => {
			return await pinned_check(options)
		})
}

// **A reason an earlier run on this branch accepted is this ship's `--unpinned-ok`** when it gives
// none (joshuafolkken/kit#4974): the pre-detach check skips its probe under it, and the supervisor's
// round 1 and its relaunch carry it, so a place the record lacks is listed and recorded after the
// detach rather than stopping the ship there.
async function with_recorded_reason(args: ShipArguments): Promise<ShipArguments> {
	if (!args.is_review || args.unpinned_ok.length > 0) return args

	const reason = await run_review_pinned_accepted.recorded_reason()

	if (reason === undefined) return args
	console.info(`${CARRIED_NOTE}${reason}`)

	return { ...args, unpinned_ok: [run_review_pinned.UNPINNED_OK_FLAG, reason] }
}

const run_ship_pre_detach_pinned = { checks_for, pinned_check, with_recorded_reason }

export { run_ship_pre_detach_pinned }
