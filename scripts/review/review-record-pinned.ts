import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'

// What `josh review:record` does about the background `josh test:pinned` (joshuafolkken/kit#4834).
//
// **A round-1 fix can add hunks the check never read**: `josh run:review` launched it on the briefed
// tree, and its join closed before the fix. The ship's pre-detach was then the first to name the fixed
// tree's unpinned places, and stopped on them. A recorded code round compares the fixed tree with the
// launch's and, where they differ, starts the check again with the launch's `--unpinned-ok` reason and
// says who reads its answer. **Nothing waits on it in the foreground** (joshuafolkken/kit#4895): the
// ship's pre-detach reads that same check's answer on that tree rather than running its own
// (`run-review-pinned-join.ts`). A foreground read stalled the lane for minutes, and pinning what it
// named moved the tree again under the next probe.
//
// **The same tree starts nothing**, and so does a tree either side could not read, or a checkout with
// no launch.

function started_line(): string {
	return `test:pinned restarted in the background on the tree this round's fixes moved; \`josh ship\`'s pre-detach reads its answer, so go on to the ship without waiting on it. Where it names unpinned places, the ship stops on them: pin each with a test that turns red without it, or ship with \`--unpinned-ok "<reason>"\`.`
}

// `root` is the checkout `josh run:review` keyed its launch to: the ledger root `review:record` writes
// under is the same working directory, and a test's temporary root holds no launch.
async function restart_if_moved(root: string = PROJECT_ROOT): Promise<void> {
	try {
		if (await run_review_pinned_join.restart_if_moved(root)) console.info(started_line())
	} catch (error) {
		error_text.trace_swallowed('review_record_pinned.restart_if_moved', error)
	}
}

const review_record_pinned = { restart_if_moved, started_line }

export { review_record_pinned }
