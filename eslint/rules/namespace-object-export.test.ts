import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { namespace_object_export_rule } from './namespace-object-export.js'

const ECMA_VERSION = 2024
const RULE_ID = 'local/namespace-object-export'
const CODING_STANDARDS_PATH = fileURLToPath(
	new URL('../../prompts/coding-standards.md', import.meta.url),
)
const TWO_FUNCTION_EXPORTS = 'export function a() {}\nexport function b() {}\n'

// Wire the rule as the `local` plugin, exactly as `eslint/base.js` does, and lint an in-memory
// module. Linting a source string exercises the AST logic without needing a real file or tsconfig.
function rule_messages(source: string): Array<Linter.LintMessage> {
	const linter = new Linter()
	const messages = linter.verify(source, [
		{
			languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' },
			plugins: { local: { rules: { 'namespace-object-export': namespace_object_export_rule } } },
			rules: { [RULE_ID]: 'error' },
		},
	])

	return messages.filter((message) => message.ruleId === RULE_ID)
}

describe('namespace-object-export — flags individual function exports', () => {
	it('flags two exported function declarations', () => {
		expect(rule_messages(TWO_FUNCTION_EXPORTS)).toHaveLength(2)
	})

	it('flags a declaration and an arrow-const export together', () => {
		const source = 'export function a() {}\nexport const b = () => {}\n'

		expect(rule_messages(source)).toHaveLength(2)
	})
})

describe('namespace-object-export — allows the compliant shapes', () => {
	it('allows a single exported function', () => {
		expect(rule_messages('export function only() {}\n')).toHaveLength(0)
	})

	it('allows two functions grouped into a namespace object', () => {
		const source = 'function a() {}\nfunction b() {}\nconst mod = { a, b }\nexport { mod }\n'

		expect(rule_messages(source)).toHaveLength(0)
	})

	it('allows individual SvelteKit route handlers', () => {
		const source = 'export function GET() {}\nexport function POST() {}\n'

		expect(rule_messages(source)).toHaveLength(0)
	})
})

describe('namespace-object-export — ignores non-function exports', () => {
	it('does not flag a constants-only file', () => {
		const source = 'export const A = 1\nexport const B = 2\n'

		expect(rule_messages(source)).toHaveLength(0)
	})

	it('does not count one function beside exported constants', () => {
		const source = 'export const A = 1\nexport function only() {}\n'

		expect(rule_messages(source)).toHaveLength(0)
	})
})

// The message is read by every consumer that trips the rule, so the section it cites has to exist —
// joshuafolkken/kit#3395 moved the conventions out of `CLAUDE.md`.
describe('namespace-object-export — the message', () => {
	it('cites the conventions section that carries the rule', () => {
		const [flagged] = rule_messages(TWO_FUNCTION_EXPORTS)

		expect(flagged?.message).toContain('See prompts/coding-standards.md → Conventions.')
		expect(readFileSync(CODING_STANDARDS_PATH, 'utf8')).toContain('\n## Conventions\n')
	})
})
