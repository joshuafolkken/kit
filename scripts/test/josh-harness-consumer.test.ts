import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { RECORD, SCENARIO_TIMEOUT_MS, ledger_at, ledger_text } = josh_harness_fixture

const environment = josh_harness_fixture.open_environments(['consumer'])

josh_harness_fixture.describe_environment('consumer', environment)

describe('josh harness — scenarios from past defects', () => {
	it(
		'records into a consumer that has no docs directory (#2402)',
		async () => {
			const consumer = environment('consumer')
			const result = await josh_harness.run(consumer, [RECORD, '--issue', '2402'])

			expect(result.exit_code).toBe(0)
			expect(result.stdout).toContain(ledger_at(consumer.root, 2402))
			expect(ledger_text(consumer.root, 2402)).toContain('#2402')
		},
		SCENARIO_TIMEOUT_MS,
	)
})

it('keeps transient files outside the consumer lint scope (#2851)', async () => {
	const consumer = environment('consumer')
	const transient_file = path.join(consumer.root, '_tmp_2851_probe')

	try {
		writeFileSync(transient_file, 'transient', 'utf8')
		const result = await josh_harness.run_command(
			'pnpm',
			['exec', 'prettier', '--file-info', transient_file],
			{ cwd: consumer.root, env: {}, timeout_ms: SCENARIO_TIMEOUT_MS },
		)

		expect(JSON.parse(result.stdout)).toMatchObject({ ignored: true })
	} finally {
		rmSync(transient_file, { force: true })
	}
})
