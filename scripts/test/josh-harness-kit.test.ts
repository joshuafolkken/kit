import { describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { RECORD, SCENARIO_TIMEOUT_MS, ledger_text } = josh_harness_fixture

const environment = josh_harness_fixture.open_environments(['kit'])

josh_harness_fixture.describe_environment('kit', environment)

describe('josh harness — the same command launched twice at once', () => {
	it(
		'keeps both lines',
		async () => {
			const kit = environment('kit')
			const results = await Promise.all([
				josh_harness.start(kit, [RECORD, '--issue', '201']),
				josh_harness.start(kit, [RECORD, '--issue', '202']),
			])

			expect(results.map((result) => result.exit_code)).toStrictEqual([0, 0])
			expect(ledger_text(kit.root, 201)).toContain('#201')
			expect(ledger_text(kit.root, 202)).toContain('#202')
		},
		SCENARIO_TIMEOUT_MS,
	)
})
