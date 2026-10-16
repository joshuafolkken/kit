import { describe, expect, it } from 'vitest'
import { usage_table_checks } from './josh-usage-fixture'
import { SESSION_USAGE } from './josh-usage-session'

describe('session usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(SESSION_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(SESSION_USAGE)).toEqual([])
	})
})
