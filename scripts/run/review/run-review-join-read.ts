import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'

// The read of `josh run:review --join` on the background `josh test:pinned` (joshuafolkken/kit#5212).
// **A join is due from the start of a pair until something reads it**: `run:review` marks it, and the
// read clears the mark first. A lane that skipped `--join` went on to `josh review:record` and the
// ship, and the unpinned places surfaced only as the ship's pre-detach failure. `review:record` asks
// whether the join is still due and, if so, reads it with this same function.

const DUE_PREFIX = 'josh-run-review-join-due-'

type PinnedWait = () => Promise<PinnedSummary | undefined>

interface JoinVerdict {
	summary: PinnedSummary
	is_stop: boolean
	text: string
}

function due_path(root: string): string {
	return stamp_file.stamp_path(DUE_PREFIX, root)
}

// A mark that could not be written loses only `review:record`'s read, never the pair's start.
function mark_due(root: string = PROJECT_ROOT): void {
	try {
		stamp_file.replace_stamp(due_path(root), { due: true })
	} catch (error) {
		error_text.trace_swallowed('run_review_join_read.mark_due', error)
	}
}

function is_due(root: string = PROJECT_ROOT): boolean {
	return stamp_file.read_stamp_text(due_path(root)) !== undefined
}

// A partial answer (joshuafolkken/kit#4936) is shown, but neither stops the round nor replaces the
// accepted `--unpinned-ok` record (`run_review_pinned_accepted.remember`). `undefined` when no check
// was launched.
async function verdict(wait: PinnedWait): Promise<JoinVerdict | undefined> {
	const summary = await wait()

	if (summary === undefined) return undefined

	if (summary.is_partial === true) {
		return { summary, is_stop: false, text: test_pinned_logic.report_text(summary) }
	}

	const judged = await run_review_pinned_accepted.judge(
		summary,
		run_review_pinned_steps.launched_reason(),
	)

	return { summary, is_stop: judged.kind === 'stop', text: judged.text }
}

// Any read of the join: the mark is cleared first, so the same answer is not shown twice.
async function read_with(
	wait: PinnedWait,
	root: string = PROJECT_ROOT,
): Promise<JoinVerdict | undefined> {
	stamp_file.remove_stamp(due_path(root))

	return await verdict(wait)
}

// `--join`'s read: the current tree's answer (`run_review_pinned_join.wait_for_join`).
async function read(
	root: string = PROJECT_ROOT,
	is_fixing = false,
): Promise<JoinVerdict | undefined> {
	return await read_with(
		async () => await run_review_pinned_join.wait_for_join(root, undefined, is_fixing),
		root,
	)
}

// `review:record`'s read: only an answer already left on this very tree
// (`run_review_pinned_join.finished_on_tree`). It neither waits (joshuafolkken/kit#4895) nor starts a
// check, so the restart that follows on a moved tree still says who reads its answer.
async function read_finished(root: string = PROJECT_ROOT): Promise<JoinVerdict | undefined> {
	return await read_with(async () => await run_review_pinned_join.finished_on_tree(root), root)
}

const run_review_join_read = { is_due, mark_due, read, read_finished, read_with, verdict }

export type { JoinVerdict, PinnedWait }
export { run_review_join_read }
