import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { DEVELOPER_USAGE } from './josh-usage-developer'

describe('developer usage table', () => {
	it('names only registered commands', () => {
		const unregistered = Object.keys(DEVELOPER_USAGE).filter(
			(name) => !Object.hasOwn(COMMAND_MAP, name),
		)

		expect(unregistered).toEqual([])
	})

	it('gives every command at least one example', () => {
		const empty = Object.entries(DEVELOPER_USAGE)
			.filter(([, usage]) => usage.examples.length === 0)
			.map(([name]) => name)

		expect(empty).toEqual([])
	})
})
