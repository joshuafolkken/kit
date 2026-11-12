import { describe, expect, it } from 'vitest'
import { josh_read_only } from './josh-read-only'

describe('josh read-only invocations', () => {
	it.each([
		[[]],
		[['--help']],
		[['-h']],
		[['help', 'ship']],
		[['--all']],
		[['ship', '--log', '5757']],
		[['cost:audit', '--period', '14']],
		[['ca']],
		[['read:set', 'fullrun']],
		[['read:set', 'fullrun', '--bytes']],
		[['exports:unused']],
		[['code:symbol', 'josh_read_only']],
	])('passes %j', (args) => {
		expect(josh_read_only.refusal(args)).toBeUndefined()
	})

	it.each([
		[['gate']],
		[['ship', 'Title #5757']],
		[['rename']],
		[['edit:files', 'plan.json']],
		[['stop:guard']],
		[['lines', 'scripts/josh/josh.ts']],
		[['no-such-command']],
		[['toString']],
	])('refuses %j and names its usage read', (args) => {
		expect(josh_read_only.refusal(args)).toContain(`pnpm josh help ${args[0] ?? ''}`)
	})

	it('names both read-only declarations an entry can make in its refusal', () => {
		expect(josh_read_only.refusal(['gate'])).toContain(
			'its entry is not declared read-only and it carries no read-only flag its entry declares',
		)
	})
})

// `tree:status` is declared read-only on its own; the writing commands registered beside it stay
// refused (joshuafolkken/kit#6554).
describe('tree status declaration', () => {
	it('passes tree:status (ac-50a9add1)', () => {
		expect(josh_read_only.refusal(['tree:status'])).toBeUndefined()
	})

	// joshuafolkken/kit#6664: the hook ledger's per-rule table only reads.
	it('passes hook:ledger (ac-e8d487a7)', () => {
		expect(josh_read_only.refusal(['hook:ledger', '--period', '7'])).toBeUndefined()
	})

	it.each([[['run:pause', '1091', '--for', '1102']], [['run:split', '1091']], [['run:stale']]])(
		'refuses the writing command %j beside it (ac-5f5c93b1)',
		(args) => {
			expect(josh_read_only.refusal(args)).toContain('is not read-only')
		},
	)
})

describe('effect audit write flags', () => {
	const COMMAND = 'effect:audit'

	it.each([[], ['--days', '7'], ['--days=7']])('passes listing %j (ac-7ed0eac7)', (...args) => {
		expect(josh_read_only.refusal([COMMAND, ...args])).toBeUndefined()
	})

	it.each([['--draft', '6476'], ['--draft=6476'], ['--days', '7', '--draft', '6476']])(
		'refuses draft %j (ac-7ed0eac7)',
		(...args) => {
			expect(josh_read_only.refusal([COMMAND, ...args])).toContain('declared write flag')
		},
	)
})

describe('josh help requests', () => {
	it.each([undefined, 'help', '--help', '-h', '--all'])('reads %s as a help request', (command) => {
		expect(josh_read_only.is_help_request(command)).toBe(true)
	})

	it('reads a command name as no help request', () => {
		expect(josh_read_only.is_help_request('ship')).toBe(false)
	})
})

describe('josh registry entries', () => {
	it('finds an alias by the command it expands to', () => {
		expect(josh_read_only.entry_of('ms')).toBe(josh_read_only.entry_of('main:sync'))
		expect(josh_read_only.entry_of('ms')).toBeDefined()
	})

	it('finds no entry for an Object.prototype member', () => {
		expect(josh_read_only.entry_of('constructor')).toBeUndefined()
	})
})
