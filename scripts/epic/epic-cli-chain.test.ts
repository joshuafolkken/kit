import { describe, expect, it } from 'vitest'
import { epic_cli_argv } from './epic-cli-argv'
import { epic_cli_chain, type ChainRead } from './epic-cli-chain'

const CHAIN = epic_cli_chain.CHAIN_FLAG
const REASON = epic_cli_chain.ORDER_REASON_FLAG
const CHILDREN = [7873, 7874, 7875]
const NOTHING_WRITTEN = /nothing was written/iu
const MISSING_REASON = /has no `--order-reason[\s\S]*Nothing was written/u
const A_TO_B = '#7873 -> #7874'
const A_TO_C = '#7873 -> #7875'
const B_TO_C = '#7874 -> #7875'
const ORDERED_CHAIN = '#7873 -> #7874 -> #7875'

function read_reasons(
	chains: ReadonlyArray<string>,
	reasons: ReadonlyArray<string>,
	is_ordered = false,
): ChainRead {
	const argv = [
		...chains.flatMap((value) => [CHAIN, value]),
		...reasons.flatMap((value) => [REASON, value]),
	]
	const parsed = epic_cli_argv.read_form(argv, { switches: [], list_flags: [CHAIN, REASON] })

	return epic_cli_chain.read_chains(parsed ?? { positionals: [], values: {} }, {
		children: CHILDREN,
		is_ordered,
	})
}

// Each chain given with a reason of its own, so these tests read the chains rather than the reasons.
function read(values: ReadonlyArray<string>, is_ordered = false): ChainRead {
	return read_reasons(
		values,
		values.map((value) => `${value}: a reason`),
		is_ordered,
	)
}

describe('epic_cli_chain.read_chains — declared chains', () => {
	it('declares nothing and asks no reason when the flag is absent', () => {
		expect(read([])).toStrictEqual({ chains: [], order_reasons: [] })
	})

	it('reads a join: one child waiting on two independent ones', () => {
		const result = read([A_TO_C, B_TO_C])

		expect(result.chains).toStrictEqual([
			[7873, 7875],
			[7874, 7875],
		])
		expect(result.chain_refusal).toBeUndefined()
	})

	it('reads a branch: two children waiting on one', () => {
		expect(read([A_TO_B, A_TO_C]).chains).toStrictEqual([
			[7873, 7874],
			[7873, 7875],
		])
	})

	it('reads a longer chain and the unicode arrow the body parser accepts', () => {
		expect(read(['#7873 → #7874 -> #7875']).chains).toStrictEqual([[7873, 7874, 7875]])
	})
})

describe('epic_cli_chain.read_chains — refusals', () => {
	it('refuses a value that is not a chain line', () => {
		const result = read(['7873 then 7875'])

		expect(result.chains).toStrictEqual([])
		expect(result.chain_refusal).toMatch(/not a chain line/u)
		expect(result.chain_refusal).toMatch(NOTHING_WRITTEN)
	})

	it('refuses a number that is not one of the children', () => {
		expect(read(['#7873 -> #9999']).chain_refusal).toMatch(/#9999.*not a child/u)
	})

	it('refuses a cycle across chains', () => {
		expect(read([A_TO_B, '#7874 -> #7873']).chain_refusal).toMatch(/cycle/u)
	})

	it('refuses a cycle within one chain', () => {
		expect(read(['#7873 -> #7874 -> #7873']).chain_refusal).toMatch(/cycle/u)
	})

	it('refuses the flag beside --ordered', () => {
		expect(read([A_TO_C], true).chain_refusal).toMatch(/--ordered/u)
	})
})

describe('epic_cli_chain.read_chains — order reasons', () => {
	it('reads one reason per declared chain', () => {
		const result = read_reasons(
			[A_TO_C, B_TO_C],
			[`${A_TO_C}: shares the schema`, `${B_TO_C}: uses the  reader\n#7874 adds`],
		)

		expect(result.order_reasons).toStrictEqual([
			{ chain: [7873, 7875], reason: 'shares the schema' },
			{ chain: [7874, 7875], reason: 'uses the reader #7874 adds' },
		])
		expect(result.chain_refusal).toBeUndefined()
	})

	it('reads a reason for the chain --ordered declares through every child', () => {
		const result = read_reasons([], [`${ORDERED_CHAIN}: each one extends the last`], true)

		expect(result.order_reasons).toStrictEqual([
			{ chain: CHILDREN, reason: 'each one extends the last' },
		])
	})

	it('refuses a reason for a chain that was not declared', () => {
		const result = read_reasons([A_TO_C], [`${A_TO_B}: not declared`])

		expect(result.chain_refusal).toMatch(/--order-reason.*nothing was written/u)
		expect(result.order_reasons).toBeUndefined()
	})

	it('refuses a value without a reason, and a second reason for one chain', () => {
		expect(read_reasons([A_TO_C], [`${A_TO_C}:  `]).chain_refusal).toMatch(NOTHING_WRITTEN)
		expect(read_reasons([A_TO_C], [A_TO_C]).chain_refusal).toMatch(NOTHING_WRITTEN)
		expect(read_reasons([A_TO_C], [`${A_TO_C}: one`, `${A_TO_C}: two`]).chain_refusal).toMatch(
			NOTHING_WRITTEN,
		)
	})
})

describe('epic_cli_chain.read_chains — a declared chain without its reason', () => {
	it('refuses the --ordered chain given no reason, naming the chain', () => {
		const result = read_reasons([], [], true)

		expect(result.chain_refusal).toMatch(MISSING_REASON)
		expect(result.chain_refusal).toContain(ORDERED_CHAIN)
		expect(result.order_reasons).toBeUndefined()
	})

	it('refuses a --chain left without a reason beside one that has its own', () => {
		const result = read_reasons([A_TO_C, B_TO_C], [`${A_TO_C}: shares the schema`])

		expect(result.chain_refusal).toMatch(MISSING_REASON)
		expect(result.chain_refusal).toContain(B_TO_C)
	})
})
