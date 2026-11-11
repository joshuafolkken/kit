import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { make_pr_snapshot, pending_rollup_snapshot } from './git-pr-checks-fixture'
import { git_pr_checks_gate } from './git-pr-checks-gate'
import type { PrStateSnapshot } from './git-pr-checks-parse'

const BRANCH = 'feature/7238-gate'
const UNCHANGED: ConditionalRead = { kind: 'unchanged' }
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }

function changed(etag: string): ConditionalRead {
	return { kind: 'changed', etag, body: '{}' }
}

function never_read_review(): boolean {
	return false
}

function always_read_review(): boolean {
	return true
}

// Each probe asks two listings, so each poll consumes two answers.
function script_probes(
	answers: ReadonlyArray<ConditionalRead>,
): MockInstance<typeof git_gh_conditional.read_conditional> {
	const spy = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) spy.mockResolvedValueOnce(answer)

	return spy
}

function gated_over(snapshots: ReadonlyArray<PrStateSnapshot>): {
	inner: ReturnType<typeof vi.fn>
	fetch: ReturnType<typeof git_pr_checks_gate.gate_fetcher>
} {
	const inner = vi.fn(async () => snapshots[inner.mock.calls.length - 1] ?? make_pr_snapshot())

	return { inner, fetch: git_pr_checks_gate.gate_fetcher(inner) }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gate_fetcher', () => {
	it('reads the full snapshot on the first poll, with nothing to reuse', async () => {
		script_probes([changed('a'), changed('b')])
		const { inner, fetch } = gated_over([make_pr_snapshot()])

		await fetch(BRANCH, never_read_review)

		expect(inner).toHaveBeenCalledTimes(1)
	})

	it('reuses the last snapshot when both listings answer 304', async () => {
		script_probes([changed('a'), changed('b'), UNCHANGED, UNCHANGED])
		const first = make_pr_snapshot({ merge_state_status: 'BLOCKED' })
		const { inner, fetch } = gated_over([first])

		await fetch(BRANCH, never_read_review)

		await expect(fetch(BRANCH, never_read_review)).resolves.toBe(first)
		expect(inner).toHaveBeenCalledTimes(1)
	})

	it('reads the full snapshot when either listing changed', async () => {
		script_probes([changed('a'), changed('b'), UNCHANGED, changed('c')])
		const second = make_pr_snapshot({ merge_state_status: 'CLEAN' })
		const { inner, fetch } = gated_over([make_pr_snapshot(), second])

		await fetch(BRANCH, never_read_review)

		await expect(fetch(BRANCH, never_read_review)).resolves.toBe(second)
		expect(inner).toHaveBeenCalledTimes(2)
	})
})

describe('gate_fetcher — the probe', () => {
	it('asks the second probe with the ETags the first one took', async () => {
		const spy = script_probes([changed('a'), changed('b'), UNCHANGED, UNCHANGED])
		const { fetch } = gated_over([make_pr_snapshot()])

		await fetch(BRANCH, never_read_review)
		await fetch(BRANCH, never_read_review)

		expect(spy.mock.calls.slice(2).map((call) => call[1])).toEqual(['a', 'b'])
	})

	it('probes the branch head, not a commit the last snapshot named', async () => {
		const spy = script_probes([changed('a'), changed('b')])
		const { fetch } = gated_over([make_pr_snapshot()])

		await fetch(BRANCH, never_read_review)

		expect(spy.mock.calls.map((call) => call[0])).toEqual([
			'repos/{owner}/{repo}/commits/feature%2F7238-gate/check-runs?per_page=100',
			'repos/{owner}/{repo}/commits/feature%2F7238-gate/status',
		])
	})
})

describe('gate_fetcher — what a 304 cannot vouch for', () => {
	it('reads again while the merge state is not yet known (#4589, #6721)', async () => {
		script_probes([changed('a'), changed('b'), UNCHANGED, UNCHANGED])
		const { inner, fetch } = gated_over([pending_rollup_snapshot()])

		await fetch(BRANCH, never_read_review)
		await fetch(BRANCH, never_read_review)

		expect(inner).toHaveBeenCalledTimes(2)
	})

	it('reads again when the poll needs the review decision', async () => {
		script_probes([changed('a'), changed('b'), UNCHANGED, UNCHANGED])
		const { inner, fetch } = gated_over([make_pr_snapshot()])

		await fetch(BRANCH, never_read_review)
		await fetch(BRANCH, always_read_review)

		expect(inner).toHaveBeenCalledTimes(2)
	})

	it('reads again when a listing could not be read', async () => {
		script_probes([changed('a'), changed('b'), UNCHANGED, UNREADABLE])
		const { inner, fetch } = gated_over([make_pr_snapshot()])

		await fetch(BRANCH, never_read_review)
		await fetch(BRANCH, never_read_review)

		expect(inner).toHaveBeenCalledTimes(2)
	})

	it('keeps no ETag from a probe whose full read threw', async () => {
		const spy = script_probes([changed('a'), changed('b'), changed('c'), changed('d')])
		const inner = vi.fn().mockRejectedValueOnce(new Error('unreadable'))
		const fetch = git_pr_checks_gate.gate_fetcher(inner)

		await expect(fetch(BRANCH, never_read_review)).rejects.toThrow('unreadable')
		inner.mockResolvedValueOnce(make_pr_snapshot())
		await fetch(BRANCH, never_read_review)

		expect(spy.mock.calls.slice(2).map((call) => call[1])).toEqual([undefined, undefined])
	})
})
