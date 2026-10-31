import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'

// **`check:related` prints the `josh test:pinned` verdict it finds already reached on this tree**
// (joshuafolkken/kit#4971): read only by the ship's pre-detach, it stopped the first `josh ship` on
// unpinned places, and the ship ran its preflight and pre-detach again once the reason was added.
// **A check this run started is waited on** (joshuafolkken/kit#4987): one still probing when the four
// checks ended printed nothing, and the ship stopped on it again. One it did not start is read as it
// stands, and one on another tree prints nothing here.

const SHIP_HINT =
	'Pin each unpinned place above with a test that turns red without it, or give the first ship its reason: `pnpm josh ship "<title> #<N>" --review … --unpinned-ok "<reason>"`.'
// The wait's bound keeps the checks within the foreground tool's budget, so the
// verdict line is never cut off; a check past it is left running for the ship's pre-detach. The checks'
// longest path is `lint:related` then `test:related` (`check-related-order.ts`).
const WAIT_MS = 240_000

async function reached(root: string, is_started: boolean): Promise<PinnedSummary | undefined> {
	if (is_started) return await run_review_pinned_join.settled_on_tree(root, WAIT_MS)

	return await run_review_pinned_join.finished_on_tree(root)
}

// The unpinned places the ship's pre-detach would stop on, with the `--unpinned-ok` form;
// `undefined` when no answer is reached on this tree or it stops nothing.
async function notice(
	root: string = PROJECT_ROOT,
	is_started = false,
): Promise<string | undefined> {
	const summary = await reached(root, is_started)
	if (summary === undefined) return undefined
	const verdict = await run_review_pinned_accepted.judge(summary, undefined)

	if (verdict.kind !== 'stop') return undefined

	return test_pinned_logic.report_text(summary, `${SHIP_HINT}\n`).trimEnd()
}

const check_related_pinned = { SHIP_HINT, WAIT_MS, notice }

export { check_related_pinned }
