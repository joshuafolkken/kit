import { randomUUID } from 'node:crypto'
import { check_reuse } from '#scripts/gate/check-reuse'
import type { JoshResult } from '#scripts/josh/josh-run'
import { buffered_process } from '#scripts/lib/buffered-process'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
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
// Its answer comes back through the record `--record` leaves (`test-pinned-record.ts`).
// Without `--review` nothing after the detach asks `test:pinned`, and `--unpinned-ok` is refused there
// (`run-ship-args.ts`), so the check is not asked.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PINNED_COMMAND = ['josh', 'test:pinned', '--record']

type PinnedOptions = Pick<ShipArguments, 'is_review' | 'unpinned_ok'>

// A check that left no answer could not run, and fails open as the one `run:review` launches does.
async function summary(): Promise<PinnedSummary> {
	const token = randomUUID()
	const result = await buffered_process.run_buffered_process([...PINNED_COMMAND, token])
	const answer = test_pinned_record.read(token)

	test_pinned_record.clear(token)

	return answer ?? test_pinned_record.not_run_summary(result.output)
}

async function pinned_check(unpinned_ok: ReadonlyArray<string>): Promise<JoshResult> {
	const reason = run_review_pinned.ok_reason_of(unpinned_ok)
	const verdict = run_review_pinned.verdict_of(await summary(), reason)

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
			return await pinned_check(options.unpinned_ok)
		})
}

const run_ship_pre_detach_pinned = { checks_for, pinned_check }

export { run_ship_pre_detach_pinned }
