import { describe, expect, it } from 'vitest'
import { epic_chain_kind } from './epic-chain-kind'

// joshuafolkken/kit#8636: a declared order at creation names its kind, or it is a pure serial chain.

const CHAIN = [8626, 8627]
const SLOWER = '分割しない理由: 全体が遅くなる'

function refusal_for(...reasons: ReadonlyArray<string>): string | undefined {
	return epic_chain_kind.find_refusal(reasons.map((reason) => ({ chain: CHAIN, reason })))
}

describe('epic_chain_kind.find_refusal', () => {
	it('refuses a reason with no kind, pointing at the one-Issue declaration', () => {
		const refusal = refusal_for('規模が大きい')

		expect(refusal).toContain('#8626 -> #8627')
		expect(refusal).toContain(SLOWER)
		expect(refusal).toContain('The question')
	})

	it.each([
		'1 パスで検証できない — 実機で確かめてから次へ',
		'別の待ちがある — #9000 の公開を待つ',
		'unverifiable in one pass — needs a live run first',
		'waits on another: the #9000 release',
	])('accepts the reason of a kind: %s', (reason) => {
		expect(refusal_for(reason)).toBeUndefined()
	})

	it('refuses a kind with no reason after it', () => {
		expect(refusal_for('別の待ちがある —')).toContain(SLOWER)
	})

	it('refuses the first reason with no kind among several', () => {
		expect(refusal_for('別の待ちがある — x', 'too large')).toContain(SLOWER)
	})

	it('asks nothing of no declared order', () => {
		expect(epic_chain_kind.find_refusal([])).toBeUndefined()
	})
})
