import { describe, expect, it } from 'vitest'
import { usage_table_checks } from './josh-usage-fixture'
import { WORKFLOW_USAGE } from './josh-usage-workflow'

describe('workflow usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(WORKFLOW_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(WORKFLOW_USAGE)).toEqual([])
	})
})
