import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { code_quality_rules } from './rules/code-quality.js'
import { TEST_HELPER_BAN_ENTRIES } from './rules/test-helper-bans.js'

const RULE_ID = 'no-restricted-syntax'

// The rule test lints through its own minimal config, so only the real `eslint.config.js` shows the
// bans reach a test file without dropping the shared selectors.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) })

async function restricted_entries(file: string): Promise<Array<unknown>> {
	const config: { rules?: Record<string, unknown> } = await eslint.calculateConfigForFile(file)
	const entry = config.rules?.[RULE_ID]

	return Array.isArray(entry) ? entry.slice(1) : []
}

function shared_entries(): Array<unknown> {
	const entry = code_quality_rules[RULE_ID]

	return Array.isArray(entry) ? entry.slice(1) : []
}

describe('eslint.config.js wires the test-helper bans', () => {
	it('composes both bans onto the shared selectors for a test file', async () => {
		expect(await restricted_entries('scripts/example.test.ts')).toEqual([
			...shared_entries(),
			...TEST_HELPER_BAN_ENTRIES,
		])
	})

	it('leaves a non-test module with the shared selectors only', async () => {
		expect(await restricted_entries('scripts/example.ts')).toEqual(shared_entries())
	})
})
