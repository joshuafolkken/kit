import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { GATE_GREEN, type GateState } from './run-review'
import { run_review_join_read, type JoinVerdict } from './run-review-join-read'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// The join can consume a complete green answer without entering either wait. Use the gate's own
// reuse predicate and the pinned launch's tree, never the mere presence of a result file (#6245).
function is_complete(summary: PinnedSummary): boolean {
	return (
		summary.unpinned.length === 0 &&
		![summary.is_partial, summary.is_cut, summary.is_unchecked].includes(true) &&
		(summary.remaining ?? 0) === 0
	)
}

function complete_answer(): PinnedSummary | undefined {
	const summary = run_review_pinned_steps.answer_now()

	return summary !== undefined && is_complete(summary) ? summary : undefined
}

function answer_on(tree: GateTree): PinnedSummary | undefined {
	const key = run_review_pinned_tree.digest_of(tree)

	if (
		key === undefined ||
		key !== run_review_pinned_steps.launched_tree() ||
		gate_skip.reusable_green_gate(tree.files, tree.base) === undefined
	) {
		return undefined
	}

	return complete_answer()
}

async function read_ready(): Promise<PinnedSummary | undefined> {
	if (!run_review_pinned_steps.is_answered()) return undefined
	const tree = await gate_tree.read_gate_tree()
	const summary = answer_on(tree)

	if (summary === undefined || (await run_ship_planned.unplanned()) !== undefined) return undefined

	return run_review_pinned_tree.digest_of(tree) === (await run_review_pinned_tree.key())
		? summary
		: undefined
}

// An unread check is never green; keep the normal join's reporting and refusal on every miss.
async function read(is_fixing = false): Promise<PinnedSummary | undefined> {
	if (is_fixing) return undefined

	try {
		return await read_ready()
	} catch (error) {
		error_text.trace_swallowed('run_review_join_ready.read', error)

		return undefined
	}
}

async function gate_state(ready: PinnedSummary | undefined): Promise<GateState> {
	return ready === undefined ? await run_review_steps.wait_for_gate_finish() : GATE_GREEN
}

async function verdict(
	ready: PinnedSummary | undefined,
	is_fixing: boolean,
): Promise<JoinVerdict | undefined> {
	return ready === undefined
		? await run_review_join_read.read(PROJECT_ROOT, is_fixing)
		: await run_review_join_read.read_with(async () => ready)
}

async function show_unplanned(ready: PinnedSummary | undefined): Promise<void> {
	if (ready === undefined) await check_related_unplanned.show()
}

const run_review_join_ready = { gate_state, read, show_unplanned, verdict }

export { run_review_join_ready }
