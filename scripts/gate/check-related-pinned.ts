import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'

// **`check:related` prints the `josh test:pinned` verdict it finds already reached on this tree**
// (joshuafolkken/kit#4971): read only by the ship's pre-detach, it stopped the first `josh ship` on
// unpinned places, and the ship ran its preflight and pre-detach again once the reason was added.
// Nothing is waited on: a check still running, or one on another tree, prints nothing here.

const SHIP_HINT =
	'Pin each unpinned place above with a test that turns red without it, or give the first ship its reason: `pnpm josh ship "<title> #<N>" --review … --unpinned-ok "<reason>"`.'

// The unpinned places the ship's pre-detach would stop on, with the `--unpinned-ok` form;
// `undefined` when no answer is reached on this tree or it stops nothing.
async function notice(root: string = PROJECT_ROOT): Promise<string | undefined> {
	const summary = await run_review_pinned_join.finished_on_tree(root)
	if (summary === undefined) return undefined
	const verdict = await run_review_pinned_accepted.judge(summary, undefined)

	return verdict.kind === 'stop' ? `${summary.text.trimEnd()}\n${SHIP_HINT}` : undefined
}

const check_related_pinned = { SHIP_HINT, notice }

export { check_related_pinned }
