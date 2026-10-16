import { describe, expect, it } from 'vitest'
import { usage_table_checks } from './josh-usage-fixture'
import { HOOK_USAGE } from './josh-usage-hooks'

describe('hook usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(HOOK_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(HOOK_USAGE)).toEqual([])
	})
})
