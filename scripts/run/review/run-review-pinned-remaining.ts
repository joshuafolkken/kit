import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'

const MOVED_NOTE = 'the tree moved while collecting remaining verdicts'

async function is_current(tree: string | undefined): Promise<boolean> {
	return tree !== undefined && tree === (await run_review_pinned_tree.key())
}

// Use the existing continuation's launch/record/cache. Ship keeps its first stop; the next join
// or record collects the rest before fixes move the tree (joshuafolkken/kit#7438).
async function start(root: string = PROJECT_ROOT): Promise<LaunchResult> {
	try {
		const tree = await run_review_pinned_tree.key()

		if (tree === undefined) return { kind: 'failed', note: 'could not read the current tree' }
		run_review_pinned_steps.clear(root)

		return run_review_pinned_steps.launch_remaining(root, tree)
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_remaining.start', error)

		return { kind: 'failed', note: String(error) }
	}
}

function is_failed(summary: PinnedSummary | undefined): summary is PinnedSummary {
	return summary?.counts === undefined && summary?.is_unchecked === true
}

async function recover_failed(summary: PinnedSummary, root: string): Promise<PinnedSummary> {
	try {
		const report = await test_pinned.cached(test_pinned_logic.DEFAULT_MAX_HUNKS)

		if (report.is_stale === true || report.unpinned.length === 0) return summary
		const known = test_pinned_record.summary_of(report, root)

		return { ...known, is_cut: true, is_unchecked: true, text: `${known.text}${summary.text}` }
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_remaining.recover_failed', error)

		return summary
	}
}

async function current_answer(root: string): Promise<PinnedSummary | undefined> {
	const summary = await run_review_pinned_steps.wait_alone(root)
	const tree = await run_review_pinned_tree.key()

	if (tree === undefined || run_review_pinned_steps.launched_tree(root) !== tree) {
		return test_pinned_record.not_run_summary(MOVED_NOTE)
	}

	const answer = is_failed(summary) ? await recover_failed(summary, root) : summary

	return (await is_current(tree)) ? answer : test_pinned_record.not_run_summary(MOVED_NOTE)
}

async function relaunched_answer(root: string): Promise<PinnedSummary | undefined> {
	const launched = await start(root)

	return launched.kind === 'launched'
		? await current_answer(root)
		: test_pinned_record.not_run_summary(launched.note)
}

// Settle an old tree into the cache first; only cache misses are probed on the current tree.
async function read(root: string = PROJECT_ROOT): Promise<PinnedSummary | undefined> {
	if (!run_review_pinned_steps.is_remaining(root)) return undefined

	if (run_review_pinned_steps.launched_tree(root) === (await run_review_pinned_tree.key())) {
		return await current_answer(root)
	}

	return (await run_review_pinned_join.answer_on_tree(root)) ?? (await relaunched_answer(root))
}

function incomplete(summary: PinnedSummary): PinnedSummary {
	return {
		...summary,
		text: `${summary.text}Remaining probe incomplete: no current-tree answer\n`,
	}
}

function collected(summary: PinnedSummary, answer: PinnedSummary | undefined): PinnedSummary {
	if (answer === undefined) return incomplete(summary)

	return answer.counts === undefined && answer.is_unchecked === true
		? { ...summary, text: `${summary.text}${answer.text}` }
		: answer
}

function is_collectable(summary: PinnedSummary, root: string): boolean {
	return summary.is_cut === true && run_review_pinned_steps.launched_reason(root) === undefined
}

async function collect_current(summary: PinnedSummary, root: string): Promise<PinnedSummary> {
	const tree = await run_review_pinned_tree.key()
	const answer = (await read(root)) ?? (await relaunched_answer(root))

	return (await is_current(tree))
		? collected(summary, answer)
		: test_pinned_record.not_run_summary(MOVED_NOTE)
}

async function collect(
	summary: PinnedSummary | undefined,
	root: string = PROJECT_ROOT,
): Promise<PinnedSummary | undefined> {
	return summary !== undefined && is_collectable(summary, root)
		? await collect_current(summary, root)
		: summary
}

const run_review_pinned_remaining = { collect, read, start }

export { run_review_pinned_remaining }
