import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { JAPANESE_RATIONALE_DIRECTORY } from './rules/english-only-prose.js'

const RULE_ID = 'kit/english-only-prose'
const ERROR_SEVERITY = 2
const OFF_SEVERITY = 0

// The rule test lints through its own minimal config, so only the real `eslint.config.js` shows the
// rule is enforced everywhere but the one directory the Content rules exempt.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) })

async function severity_for(file: string): Promise<unknown> {
	const config: { rules?: Record<string, unknown> } = await eslint.calculateConfigForFile(file)
	const entry = config.rules?.[RULE_ID]

	return Array.isArray(entry) ? entry[0] : entry
}

describe('eslint.config.js wires the English-only prose rule', () => {
	it('enforces it as an error outside the exempt directory', async () => {
		expect(await severity_for('scripts/example.ts')).toBe(ERROR_SEVERITY)
	})

	it('switches it off inside the exempt directory', async () => {
		expect(await severity_for(`${JAPANESE_RATIONALE_DIRECTORY}example.js`)).toBe(OFF_SEVERITY)
	})
})
