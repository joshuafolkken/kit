import { describe, expect, it } from 'vitest'
import { usage_table_checks } from './josh-usage-fixture'
import { REVIEW_USAGE } from './josh-usage-review'

describe('review usage table', () => {
	it('names only registered commands', () => {
		expect(usage_table_checks.unregistered_commands(REVIEW_USAGE)).toEqual([])
	})

	it('gives every command at least one example', () => {
		expect(usage_table_checks.commands_without_examples(REVIEW_USAGE)).toEqual([])
	})
})
