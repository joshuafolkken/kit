import type { ClaudeResultEvent } from '#scripts/agent/claude-result-event'
import { describe, expect, it } from 'vitest'
import {
	ABANDONED_VERDICT,
	CUT_VERDICT,
	MERGED_VERDICT,
	run_ending,
	UNREADABLE_VERDICT,
	type EndingTraces,
} from './run-ending'

const SUCCESS_EXIT: ClaudeResultEvent = {
	is_error: false,
	subtype: 'success',
	num_turns: 53,
	permission_denials: 3,
	reason: undefined,
	usage: undefined,
}

function traces(overrides: Partial<EndingTraces> = {}): EndingTraces {
	return {
		exit_record: SUCCESS_EXIT,
		is_child_closed: false,
		is_cut_taken: false,
		is_tree_dirty: true,
		...overrides,
	}
}

describe('classifying how a lane child ended', () => {
	it('reports a CLOSED issue as merged', () => {
		expect(run_ending.decide(traces({ is_child_closed: true })).verdict).toBe(MERGED_VERDICT)
	})

	it('reports a carried cut as a hand-off, even when the issue is CLOSED', () => {
		expect(run_ending.decide(traces({ is_cut_taken: true, is_child_closed: true })).verdict).toBe(
			CUT_VERDICT,
		)
	})

	it('reports an OPEN issue with no cut as abandoned', () => {
		expect(run_ending.decide(traces()).verdict).toBe(ABANDONED_VERDICT)
	})

	// The distinction that was missing: a child that exits `is_error: false` while its issue is still
	// OPEN and uncut is abandoned, never merged. A normal exit code is not a completion.
	it('does not read a normal exit code as completion', () => {
		const decision = run_ending.decide(
			traces({ exit_record: { ...SUCCESS_EXIT, is_error: false } }),
		)

		expect(decision.verdict).toBe(ABANDONED_VERDICT)
		expect(decision.verdict).not.toBe(MERGED_VERDICT)
	})

	it('is unreadable when the issue state could not be read', () => {
		expect(run_ending.decide(traces({ is_child_closed: undefined })).verdict).toBe(
			UNREADABLE_VERDICT,
		)
	})

	it('is unreadable when the issue is OPEN but the exit record is missing', () => {
		expect(run_ending.decide(traces({ exit_record: undefined })).verdict).toBe(UNREADABLE_VERDICT)
	})
})

describe('the basis an abandoned verdict carries', () => {
	it('names the exit-record fields it read and the permission-denial count', () => {
		const { evidence } = run_ending.decide(traces())

		expect(evidence).toContain('subtype=success')
		expect(evidence).toContain('num_turns=53')
		expect(evidence).toContain('permission_denials=3')
	})

	it('reports whether uncommitted work is still on disk', () => {
		expect(run_ending.decide(traces({ is_tree_dirty: true })).evidence).toContain(
			'uncommitted work remains',
		)
		expect(run_ending.decide(traces({ is_tree_dirty: false })).evidence).toContain(
			'the tree is clean',
		)
	})
})
