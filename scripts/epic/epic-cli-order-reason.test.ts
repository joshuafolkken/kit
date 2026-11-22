import { describe, expect, it } from 'vitest'
import { epic_cli } from './epic-cli'

// Every entry that declares an order — creation and `--promote` here, `--add --chain` in
// `epic-cli-add-chain.test.ts` — refuses a declared chain given without its `--order-reason`.

const TITLE = 'Epic: staged rollout'
const PROMOTE = '--promote'
const REASON = '--order-reason'
const MISSING_REASON = /has no `--order-reason[\s\S]*Nothing was written/u
const ORDERED_CHAIN = '#101 -> #102'
const ORDERED = '--ordered'
const CHAIN = '--chain'
const FIRST_JOIN = '#101 -> #103'
const SECOND_JOIN = '#102 -> #103'

describe('epic_cli.parse_create_arguments — a declared order needs its reason', () => {
	it('refuses --ordered given no reason', () => {
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', '102', ORDERED])

		expect(parsed?.chain_refusal).toMatch(MISSING_REASON)
	})

	it('takes --ordered with the reason for its chain', () => {
		const why = '1 パスで検証できない — #102 uses #101'
		const argv = [TITLE, '101', '102', ORDERED, REASON, `${ORDERED_CHAIN}: ${why}`]
		const parsed = epic_cli.parse_create_arguments(argv)

		expect(parsed?.chain_refusal).toBeUndefined()
		expect(parsed?.order_reasons).toStrictEqual([{ chain: [101, 102], reason: why }])
	})

	it('refuses a --chain left without a reason beside one that has its own', () => {
		const chains = [CHAIN, FIRST_JOIN, CHAIN, SECOND_JOIN, REASON, `${FIRST_JOIN}: #103 reads #101`]
		const argv = [TITLE, '101', '102', '103', ...chains]

		expect(epic_cli.parse_create_arguments(argv)?.chain_refusal).toContain(SECOND_JOIN)
	})

	it('asks no reason of an unordered creation', () => {
		expect(epic_cli.parse_create_arguments([TITLE, '101', '102'])?.chain_refusal).toBeUndefined()
	})
})

describe('epic_cli.parse_promote_arguments — a declared order needs its reason', () => {
	it('refuses a promotion whose --ordered has no reason', () => {
		const parsed = epic_cli.parse_promote_arguments([PROMOTE, '858', '101', '102', ORDERED])

		expect(parsed?.chain_refusal).toMatch(MISSING_REASON)
	})
})
