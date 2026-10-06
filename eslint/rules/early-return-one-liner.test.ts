import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { early_return_one_liner_rule } from './early-return-one-liner.js'

const ECMA_VERSION = 2024
const RULE_ID = 'local/early-return-one-liner'

// Wire the rule as the `local` plugin, exactly as `eslint/base.js` does, and lint an in-memory
// module. Linting a source string exercises the AST logic without needing a real file or tsconfig.
const CONFIG: Linter.Config = {
	languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' },
	plugins: { local: { rules: { 'early-return-one-liner': early_return_one_liner_rule } } },
	rules: { [RULE_ID]: 'error' },
}

function rule_messages(source: string): Array<Linter.LintMessage> {
	return new Linter().verify(source, CONFIG).filter((message) => message.ruleId === RULE_ID)
}

function fixed(source: string): string {
	return new Linter().verifyAndFix(source, CONFIG).output
}

const BLOCK_RETURN = '\tif (x) {\n\t\treturn 1\n\t}'
const ONE_LINER = '\tif (x) return 1'

function wrap(body: string): string {
	return `function probe(x) {\n${body}\n\treturn 0\n}\n`
}

describe('early-return-one-liner — flags a block around a single short return', () => {
	it('flags a block holding only a return with a value', () => {
		expect(rule_messages(wrap(BLOCK_RETURN))).toHaveLength(1)
	})

	it('flags a block holding only a bare return', () => {
		expect(rule_messages(wrap('\tif (x) {\n\t\treturn\n\t}'))).toHaveLength(1)
	})

	it('fixes the block into the one-liner form', () => {
		expect(fixed(wrap(BLOCK_RETURN))).toBe(wrap(ONE_LINER))
	})
})

describe('early-return-one-liner — allows the shapes it does not cover', () => {
	it('allows the one-liner itself', () => {
		expect(rule_messages(wrap(ONE_LINER))).toHaveLength(0)
	})

	it('allows an if with an else branch', () => {
		const source = wrap('\tif (x) {\n\t\treturn 1\n\t} else {\n\t\tx += 1\n\t}')

		expect(rule_messages(source)).toHaveLength(0)
	})

	it('allows a block with more than one statement', () => {
		expect(rule_messages(wrap('\tif (x) {\n\t\tx += 1\n\t\treturn x\n\t}'))).toHaveLength(0)
	})

	it('allows a block that carries a comment', () => {
		expect(rule_messages(wrap('\tif (x) {\n\t\t// why\n\t\treturn 1\n\t}'))).toHaveLength(0)
	})

	it('allows a return whose one-liner would pass the print width', () => {
		const long_value = `'${'a'.repeat(90)}'`

		expect(rule_messages(wrap(`\tif (x) {\n\t\treturn ${long_value}\n\t}`))).toHaveLength(0)
	})

	// The `} else ` before an `else if` shares the line, so it counts toward the print width: the
	// one-liner here fits from the indent alone but not after it, and Prettier would break it.
	it('allows an else-if return whose one-liner would pass the print width after the else', () => {
		const long_value = `'${'a'.repeat(80)}'`
		const source = wrap(
			`\tif (x === 1) {\n\t\tx += 1\n\t} else if (x) {\n\t\treturn ${long_value}\n\t}`,
		)

		expect(rule_messages(source)).toHaveLength(0)
	})

	it('allows a return whose value spans several lines', () => {
		const source = wrap('\tif (x) {\n\t\treturn {\n\t\t\ta: 1,\n\t\t\tb: 2,\n\t\t}\n\t}')

		expect(rule_messages(source)).toHaveLength(0)
	})
})
