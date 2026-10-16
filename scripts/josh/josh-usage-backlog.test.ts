import { describe, expect, it } from 'vitest'
import { BACKLOG_USAGE } from './josh-usage-backlog'
import { usage_table_checks } from './josh-usage-fixture'

describe('backlog usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(BACKLOG_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(BACKLOG_USAGE)).toEqual([])
	})
})
