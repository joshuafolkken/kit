import { describe, expect, it } from 'vitest'
import { DEVELOPER_USAGE } from './josh-usage-developer'
import { usage_table_checks } from './josh-usage-fixture'

describe('developer usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(DEVELOPER_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(DEVELOPER_USAGE)).toEqual([])
	})
})
