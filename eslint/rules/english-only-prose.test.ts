import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { english_only_prose_plugin } from './english-only-prose.js'

const ECMA_VERSION = 2024
const RULE_ID = 'kit/english-only-prose'

// A minimal flat config mirroring how `eslint.config.js` wires the rule: the plugin under the `kit`
// namespace, the rule set to error. Linting an inline source exercises the comment scan and the
// title/message detection without a real tsconfig.
function messages_for(source: string): Array<Linter.LintMessage> {
	const linter = new Linter()

	return linter.verify(source, [
		{ languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' } },
		{ plugins: { kit: english_only_prose_plugin }, rules: { [RULE_ID]: 'error' } },
	])
}

function count(source: string): number {
	return messages_for(source).filter((message) => message.ruleId === RULE_ID).length
}

describe('english-only-prose — comments', () => {
	it('flags a line comment written in Japanese', () => {
		const messages = messages_for('// これは日本語のコメント\nconst PROBE = 1\n')

		expect(messages).toHaveLength(1)
		expect(messages[0]?.messageId).toBe('comment')
	})

	it('flags a Japanese block comment and a JSDoc comment', () => {
		expect(count('/* 日本語のブロック */\nconst PROBE = 1\n')).toBe(1)
		expect(count('/** 日本語の JSDoc */\nfunction probe() {}\n')).toBe(1)
	})

	it('flags a Japanese trailing comment after code', () => {
		expect(count('const PROBE = 1 // 末尾のコメント\n')).toBe(1)
	})

	it('allows an English comment', () => {
		expect(count('// a plain English comment\nconst PROBE = 1\n')).toBe(0)
	})

	it('allows non-CJK symbols an English comment may carry (≤ → é)', () => {
		expect(count('// complexity ≤5 → resolved, naïve café\nconst PROBE = 1\n')).toBe(0)
	})
})

describe('english-only-prose — test titles and expect messages', () => {
	it('flags a Japanese describe/it/test title', () => {
		expect(count("describe('日本語のタイトル', () => {})\n")).toBe(1)
		expect(count("it('日本語のケース', () => {})\n")).toBe(1)
		expect(count("test('日本語のテスト', () => {})\n")).toBe(1)
	})

	it('flags a Japanese title on it.only / describe.skip', () => {
		expect(count("it.only('日本語のケース', () => {})\n")).toBe(1)
		expect(count("describe.skip('日本語のタイトル', () => {})\n")).toBe(1)
	})

	it('flags a Japanese template-literal title with no substitution', () => {
		expect(count('it(`日本語のケース`, () => {})\n')).toBe(1)
	})

	it('flags a Japanese expect message (the second argument)', () => {
		expect(count("expect(1, 'ゼロであるべき').toBe(1)\n")).toBe(1)
	})

	it('allows an English title and an English expect message', () => {
		expect(count("describe('an English title', () => {})\n")).toBe(0)
		expect(count("expect(1, 'should be one').toBe(1)\n")).toBe(0)
	})
})

// The rule's subject is prose, not data: Japanese in an ordinary string literal — a fixture, a
// pattern, an assertion's expected value — is the exact case the Content rule leaves alone, so it must
// not be flagged.
describe('english-only-prose — Japanese as data is not prose', () => {
	it('allows Japanese in a plain string literal', () => {
		expect(count("const LABEL = '日本語のデータ'\n")).toBe(0)
	})

	it('allows Japanese as the expected value of an assertion', () => {
		expect(count("expect(parse(input)).toBe('日本語')\n")).toBe(0)
	})

	it('allows Japanese inside a non-title call argument', () => {
		expect(count("translate('日本語のデータ')\n")).toBe(0)
	})
})
