import { describe, expect, it } from 'vitest'
import { AUTOMATION_USAGE } from './josh-usage-automation'
import { usage_table_checks } from './josh-usage-fixture'

describe('automation usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(AUTOMATION_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(AUTOMATION_USAGE)).toEqual([])
	})
})
