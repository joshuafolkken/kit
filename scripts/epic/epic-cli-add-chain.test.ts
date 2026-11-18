import { describe, expect, it } from 'vitest'
import { epic_cli } from './epic-cli'

const JOIN = '#7999 -> #7996'

function parse(...flags: Array<string>): ReturnType<typeof epic_cli.parse_add_arguments> {
	return epic_cli.parse_add_arguments(['--add', '7916', '7999', ...flags])
}

describe('epic_cli.parse_add_arguments — --chain', () => {
	it('reads each chain the insertion declares', () => {
		const parsed = parse('--chain', JOIN, '--chain', '#7997 -> #7996')

		expect(parsed?.chains).toEqual([
			[7999, 7996],
			[7997, 7996],
		])
	})

	it('leaves an existing child in the chain to the plan, which knows the epic', () => {
		expect(parse('--chain', JOIN)?.chain_refusal).toBeUndefined()
	})

	it('keeps the children a bare list', () => {
		expect(parse('--chain', JOIN)?.children).toEqual([7999])
	})

	it('reads no chain when the flag is absent', () => {
		expect(parse()?.chains).toEqual([])
	})

	it('refuses a value that is not a chain line', () => {
		expect(parse('--chain', '7999 then 7996')?.chain_refusal).toContain('not a chain line')
	})

	it('refuses a chain beside --before', () => {
		expect(parse('--chain', JOIN, '--before', '7996')?.chain_refusal).toContain('`--before`')
	})

	it('refuses a chain beside --order-after', () => {
		expect(parse('--chain', JOIN, '--order-after', '7996')?.chain_refusal).toContain(
			'`--order-after`',
		)
	})

	it('refuses a cycle within the declarations', () => {
		const parsed = parse('--chain', JOIN, '--chain', '#7996 -> #7999')

		expect(parsed?.chain_refusal).toContain('cycle')
	})
})

describe('epic_cli.format_cross_repo_refusal — --chain', () => {
	it('carries the chains into the suggested command', () => {
		const found = epic_cli.find_cross_repo_add_target([
			'--add',
			'joshuafolkken/kit#7916',
			'7999',
			'--chain',
			JOIN,
		])

		expect(found && epic_cli.format_cross_repo_refusal(found)).toContain(`--chain "${JOIN}"`)
	})
})
