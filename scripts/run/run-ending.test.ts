import type { ClaudeResultEvent } from '#scripts/agent/claude-result-event'
import { describe, expect, it } from 'vitest'
import {
	ABANDONED_VERDICT,
	CUT_VERDICT,
	MERGED_VERDICT,
	OUTAGE_VERDICT,
	run_ending,
	UNREADABLE_VERDICT,
	type EndingTraces,
} from './run-ending'

const OUTAGE_EXIT: ClaudeResultEvent = {
	is_error: true,
	subtype: 'success',
	num_turns: 19,
	permission_denials: 0,
	refused_ask: undefined,
	reason: 'Unable to connect to API (ConnectionRefused)',
	usage: undefined,
}

const SUCCESS_EXIT: ClaudeResultEvent = {
	is_error: false,
	subtype: 'success',
	num_turns: 53,
	permission_denials: 3,
	refused_ask: undefined,
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

// joshuafolkken/kit#2240: the four cases the acceptance criteria name — a child that could not reach
// the API, an ordinary mid-implementation stop, a merged child, and an unreadable record — are the
// distinctions the verdict has to draw. The outage case is the one that was missing: a mid-run exit on
// a transport-failure signature is `outage`, told apart from `abandoned` so the parent leaves it
// re-dispatchable rather than parking it.
describe('an API outage told apart from an ordinary mid-implementation stop', () => {
	it('reads a connection-error exit on an OPEN, uncut issue as an outage', () => {
		expect(run_ending.decide(traces({ exit_record: OUTAGE_EXIT })).verdict).toBe(OUTAGE_VERDICT)
	})

	it('still reads an ordinary mid-implementation stop as abandoned', () => {
		expect(run_ending.decide(traces()).verdict).toBe(ABANDONED_VERDICT)
	})

	it('reads a CLOSED issue as merged even when the exit record shows a connection error', () => {
		expect(
			run_ending.decide(traces({ exit_record: OUTAGE_EXIT, is_child_closed: true })).verdict,
		).toBe(MERGED_VERDICT)
	})

	it('is unreadable when the exit record is missing, whatever the connection', () => {
		expect(run_ending.decide(traces({ exit_record: undefined })).verdict).toBe(UNREADABLE_VERDICT)
	})

	it('names the transport-failure signature in the basis', () => {
		expect(run_ending.decide(traces({ exit_record: OUTAGE_EXIT })).evidence).toContain(
			'unable to connect to api',
		)
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

	// **The backstop for a child that slipped past the `PreToolUse` refusal** (joshuafolkken/kit#2201):
	// its stranded question is lifted out of the exit record and into the park basis, so the parent does
	// not open the JSONL by hand.
	it('carries the refused interactive ask when the exit record preserved one', () => {
		const exit_record = { ...SUCCESS_EXIT, refused_ask: 'Which library? [zod / valibot]' }

		expect(run_ending.decide(traces({ exit_record })).evidence).toContain(
			'the refused interactive ask was — Which library? [zod / valibot]',
		)
	})

	// A child that asked nothing leaves the basis unchanged — no empty ask clause dangling in it.
	it('says nothing about a refused ask when the child asked nothing', () => {
		expect(run_ending.decide(traces()).evidence).not.toContain('refused interactive ask')
	})
})
