import { describe, expect, it } from 'vitest'
import { epic_cli } from './epic-cli'

const JOIN = '#7999 -> #7996'
const JOIN_REASON = `${JOIN}: #7996 reads the flag #7999 adds`
const REASON = '--order-reason'
const SECOND = '#7997 -> #7996'
const TWO_CHAINS = ['--chain', JOIN, '--chain', SECOND, REASON, JOIN_REASON, REASON, `${SECOND}: x`]

function parse(...flags: Array<string>): ReturnType<typeof epic_cli.parse_add_arguments> {
	return epic_cli.parse_add_arguments(['--add', '7916', '7999', ...flags])
}

describe('epic_cli.parse_add_arguments — --chain', () => {
	it('reads each chain the insertion declares', () => {
		const parsed = parse(...TWO_CHAINS)

		expect(parsed?.chain_refusal).toBeUndefined()
		expect(parsed?.chains).toEqual([
			[7999, 7996],
			[7997, 7996],
		])
	})

	it('leaves an existing child in the chain to the plan, which knows the epic', () => {
		expect(parse('--chain', JOIN, REASON, JOIN_REASON)?.chain_refusal).toBeUndefined()
	})

	it('keeps the children a bare list', () => {
		expect(parse('--chain', JOIN, REASON, JOIN_REASON)?.children).toEqual([7999])
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

describe('epic_cli.parse_add_arguments — --order-reason', () => {
	it('reads no chain, and asks no reason, when --chain is absent', () => {
		const parsed = parse()

		expect(parsed?.chains).toEqual([])
		expect(parsed?.chain_refusal).toBeUndefined()
	})

	it('carries the reason given for each chain', () => {
		expect(parse('--chain', JOIN, REASON, JOIN_REASON)?.order_reasons).toEqual([
			{ chain: [7999, 7996], reason: '#7996 reads the flag #7999 adds' },
		])
	})

	it('refuses a chain given without its --order-reason', () => {
		expect(parse('--chain', JOIN)?.chain_refusal).toMatch(/has no `--order-reason/u)
	})
})

function cross_repo_suggestion(reason = JOIN_REASON): string | undefined {
	const found = epic_cli.find_cross_repo_add_target([
		'--add',
		'joshuafolkken/kit#7916',
		'7999',
		'--chain',
		JOIN,
		REASON,
		reason,
	])

	return found && epic_cli.format_cross_repo_refusal(found)
}

describe('epic_cli.format_cross_repo_refusal — --chain', () => {
	it('carries the chains into the suggested command', () => {
		expect(cross_repo_suggestion()).toContain(`--chain "${JOIN}"`)
	})

	it('carries each chain reason into the suggested command', () => {
		expect(cross_repo_suggestion()).toContain(`${REASON} '${JOIN_REASON}'`)
	})

	it('single-quotes a reason so its backtick and $ reach the other checkout unexpanded', () => {
		const tail = `reads \`josh\` and $HOME, isn't run`
		const quoted_tail = String.raw`reads ${'`'}josh${'`'} and $HOME, isn'\''t run'`

		expect(cross_repo_suggestion(`${JOIN}: ${tail}`)).toContain(
			`${REASON} '${JOIN}: ${quoted_tail}`,
		)
	})
})
