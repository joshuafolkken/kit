import { randomUUID } from 'node:crypto'
import { check_reuse } from '#scripts/gate/check-reuse'
import type { JoshResult } from '#scripts/josh/josh-run'
import { buffered_process } from '#scripts/lib/buffered-process'
import { error_text } from '#scripts/lib/error-message'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_ship_pre_detach } from './run-ship-pre-detach'
import type { ShipArguments } from './run-ship-steps'

// `josh test:pinned` among the pre-detach checks of a `josh ship --review` (joshuafolkken/kit#4785). The
// child's `run:review` checked the tree it saw; a round-1 fix made after it reached no `test:pinned`
// until the supervisor's review stage stopped on it, after the detach. Here it stops in the
// foreground, with the text and the `--unpinned-ok` judgment `run:review --join` uses
// (`run-review-pinned.ts`).
//
// **It runs as its own `josh` command**, so it reserves its own cores (`DIRECT_UNIT_CLAIM`) beside the
// other checks rather than probing outside the budget, and it reads the same per-checkout verdict cache
// (`test-pinned-cache.ts`): on the tree `run:review` checked it starts no probe, and after a fix it
// probes only the hunks whose stored verdict that cache no longer holds (`test-pinned-cache-logic.ts`).
// Its answer comes back through the record `--record` leaves (`test-pinned-record.ts`). Under
// `--unpinned-ok "<reason>"` it runs only when the supervisor reuses round 1 (`pinned_check`).
// Without `--review` nothing after the detach asks `test:pinned`, and `--unpinned-ok` is refused there
// (`run-ship-args.ts`), so the check is not asked.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PINNED_COMMAND = ['josh', 'test:pinned', '--record']
const SKIPPED_NOTE =
	'test:pinned not run before the detach; round 1 lists the unpinned places under --unpinned-ok: '

type CheckOptions = Pick<ShipArguments, 'number' | 'unpinned_ok'>
type PinnedOptions = CheckOptions & Pick<ShipArguments, 'is_review'>

// A check that left no answer could not run, and fails open as the one `run:review` launches does.
async function summary(): Promise<PinnedSummary> {
	const token = randomUUID()
	const result = await buffered_process.run_buffered_process([...PINNED_COMMAND, token])
	const answer = test_pinned_record.read(token)

	test_pinned_record.clear(token)

	return answer ?? test_pinned_record.not_run_summary(result.output)
}

// Whether the supervisor runs a fresh round 1, whose `run:review --join` lists and records the unpinned
// places under the reason. A reused round 1 — after the ship's own round 1 stopped, the lane's fix
// included — runs no `test:pinned` (`review-round-reuse.ts`). A question git could not answer probes.
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

	const verdict = await run_review_pinned_accepted.judge(await summary(), reason)

	return {
		code: verdict.kind === 'stop' ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE,
		out: verdict.text,
	}
}

// The pre-detach checks this ship runs, `test:pinned` among them under `--review`.
function checks_for(options: PinnedOptions): () => Promise<JoshResult> {
	if (!options.is_review) return async () => await run_ship_pre_detach.checks()

	return async () =>
		await run_ship_pre_detach.checks(process.cwd(), check_reuse.DEFAULT_RECORDS, async () => {
			return await pinned_check(options)
		})
}

const run_ship_pre_detach_pinned = { checks_for, pinned_check }

export { run_ship_pre_detach_pinned }
