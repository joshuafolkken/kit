import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { review_finding_ledger } from './review-finding-ledger'

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
// no launch. The fix's first `josh check:related` runs this same restart (joshuafolkken/kit#4948), so a
// record on the tree it checked takes over the check already running there. `check:related` alone
// waits on the check it started (joshuafolkken/kit#4987), within a bound that keeps the verdict line
// under a foreground Bash call's cap (`check-related-pinned.ts`).

function started_line(): string {
	return `test:pinned restarted in the background on the tree this round's fixes moved. Where it names unpinned places, the ship's pre-detach stops on them: pin each with a test that turns red without it, or ship with \`--unpinned-ok "<reason>"\`.`
}

// `root` is the checkout `josh run:review` keyed its launch to: the ledger root `review:record` writes
// under is the same working directory, and a test's temporary root holds no launch. Answers whether a
// check was started.
async function restart_if_moved(root: string = PROJECT_ROOT): Promise<boolean> {
	try {
		const is_started = await run_review_pinned_join.restart_if_moved(root)

		if (is_started) console.info(started_line())

		return is_started
	} catch (error) {
		error_text.trace_swallowed('review_record_pinned.restart_if_moved', error)

		return false
	}
}

// Whether the lane's code round is on the ledger: from then on `review:record` owns the restart, behind
// its own handover guard.
async function is_round_recorded(root: string): Promise<boolean> {
	const issue = lane_child_marker.marked_issue()
	if (issue === undefined) return false
	const content = await observation_ledger_home.read(root)

	return content !== undefined && review_finding_ledger.has_issue_record(content, Number(issue))
}

// `josh check:related`'s restart (joshuafolkken/kit#4948) runs only in a lane child outside a ship's
// supervisor and before its round 1 is recorded: a launch record outlives its issue in a reused
// checkout, and a child relaunched after a ship stop may re-detach without `--review`, which reads no
// answer.
async function is_restartable_before_record(root: string): Promise<boolean> {
	if (!lane_child_marker.is_child_of(root) || run_ship_detach.is_supervised()) return false

	return !(await is_round_recorded(root))
}

// Answers whether a check was started, so `check:related` waits on its answer (joshuafolkken/kit#4987).
async function restart_in_lane(root: string = PROJECT_ROOT): Promise<boolean> {
	try {
		return (await is_restartable_before_record(root)) && (await restart_if_moved(root))
	} catch (error) {
		error_text.trace_swallowed('review_record_pinned.restart_in_lane', error)

		return false
	}
}

const review_record_pinned = { restart_if_moved, restart_in_lane, started_line }

export { review_record_pinned }
