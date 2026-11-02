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
