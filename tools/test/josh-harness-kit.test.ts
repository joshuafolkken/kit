import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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
				josh_harness.run(kit, [RECORD, '--issue', '201']),
				josh_harness.run(kit, [RECORD, '--issue', '202']),
			])

			expect(results.map((result) => result.exit_code)).toStrictEqual([0, 0])
			expect(ledger_text(kit.root, 201)).toContain('#201')
			expect(ledger_text(kit.root, 202)).toContain('#202')
		},
		SCENARIO_TIMEOUT_MS,
	)
})

// The fixture borrows this checkout's `node_modules` through a symlink, so a daemon it reached would
// be keyed on this checkout's own record (joshuafolkken/kit#4386).
function daemon_record(root: string): string | undefined {
	try {
		return readFileSync(path.join(root, 'node_modules', 'eslint', '.eslint_d'), 'utf8')
	} catch {
		return undefined
	}
}

describe('josh harness — lint:related in a repository that borrows node_modules', () => {
	it(
		"leaves the lending checkout's eslint_d record as it was",
		async () => {
			const kit = environment('kit')
			const before = daemon_record(kit.root)

			writeFileSync(path.join(kit.root, 'change.ts'), 'export const value = 1\n', 'utf8')
			const result = await josh_harness.run(kit, ['lint:related'])

			expect(result.exit_code, result.stdout).toBe(0)
			expect(daemon_record(kit.root)).toBe(before)
		},
		SCENARIO_TIMEOUT_MS,
	)
})
