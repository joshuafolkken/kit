import { describe, expect, it } from 'vitest'
import { usage_table_checks } from './josh-usage-fixture'
import { RUN_USAGE } from './josh-usage-run'

describe('run usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(RUN_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(RUN_USAGE)).toEqual([])
	})
})
