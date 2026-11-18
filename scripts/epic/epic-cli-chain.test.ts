import { describe, expect, it } from 'vitest'
import { epic_cli_argv } from './epic-cli-argv'
import { epic_cli_chain, type ChainRead } from './epic-cli-chain'

const CHAIN = epic_cli_chain.CHAIN_FLAG
const CHILDREN = [7873, 7874, 7875]
const NOTHING_WRITTEN = /nothing was written/iu
const A_TO_B = '#7873 -> #7874'
const A_TO_C = '#7873 -> #7875'
const B_TO_C = '#7874 -> #7875'

function read(values: ReadonlyArray<string>, is_ordered = false): ChainRead {
	const argv = values.flatMap((value) => [CHAIN, value])
	const parsed = epic_cli_argv.read_form(argv, { switches: [], list_flags: [CHAIN] })

	return epic_cli_chain.read_chains(parsed ?? { positionals: [], values: {} }, {
		children: CHILDREN,
		is_ordered,
	})
}

describe('epic_cli_chain.read_chains — declared chains', () => {
	it('declares nothing when the flag is absent', () => {
		expect(read([])).toStrictEqual({ chains: [] })
	})

	it('reads a join: one child waiting on two independent ones', () => {
		expect(read([A_TO_C, B_TO_C])).toStrictEqual({
			chains: [
				[7873, 7875],
				[7874, 7875],
			],
		})
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
