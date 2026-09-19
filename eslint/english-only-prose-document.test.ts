import { CANONICAL_DOC, read_repo_file } from '#scripts/document/ai-document-fixture'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { english_only_prose_plugin } from './rules/english-only-prose.js'

// Issue #2124: the Content rule "comments and test titles are English only" was prose while every
// sibling limit was machine-enforced. This suite is the guard the two do not drift — the same shape as
// quality-limits-document.test.ts: the document's statement is read back, the wiring that is supposed
// to match it is read out of eslint.config.js, and the rule's behavior is asserted, so removing any
// half fails here rather than passing silently.

const RULE_ID = 'kit/english-only-prose'
const CONTENT_RULE_MARKER = 'Comments / test titles'
const ENGLISH_ONLY_MARKER = 'English only'
const EXCEPTION_PATH = 'eslint/rules/'
const ECMA_VERSION = 2024

// The config file is read as text rather than imported — a parent-relative `../eslint.config.js`
// import is banned, and the wiring is a pair of literal lines a string check pins exactly.
const CONFIG_SOURCE = read_repo_file('eslint.config.js')
const ENABLED_LINE = `'${RULE_ID}': 'error'`
const DISABLED_LINE = `'${RULE_ID}': 'off'`
const OFF_FOR_ESLINT_RULES = /['"]eslint\/rules\/\*\*['"][\S\s]*?'off'/u

function content_rule_line(): string {
	const line = read_repo_file(CANONICAL_DOC)
		.split('\n')
		.find((candidate) => candidate.includes(CONTENT_RULE_MARKER))

	return line ?? ''
}

function count(source: string): number {
	const linter = new Linter()
	const messages = linter.verify(source, [
		{ languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' } },
		{ plugins: { kit: english_only_prose_plugin }, rules: { [RULE_ID]: 'error' } },
	])

	return messages.filter((message) => message.ruleId === RULE_ID).length
}

describe('CLAUDE.md states the English-only content rule', () => {
	const line = content_rule_line()

	it('has the content-rule line', () => {
		expect(line).not.toBe('')
	})

	it('says the prose must be English only', () => {
		expect(line).toContain(ENGLISH_ONLY_MARKER)
	})

	it('names the eslint/rules exception', () => {
		expect(line).toContain(EXCEPTION_PATH)
	})
})

describe('eslint.config.js wires the rule the document describes', () => {
	it('enables it as an error', () => {
		expect(CONFIG_SOURCE).toContain(ENABLED_LINE)
	})

	it('turns it off for the eslint/rules exception', () => {
		expect(CONFIG_SOURCE).toContain(DISABLED_LINE)
		expect(CONFIG_SOURCE).toMatch(OFF_FOR_ESLINT_RULES)
	})
})

describe('the rule enforces exactly what the document states', () => {
	it('flags a Japanese comment', () => {
		expect(count('// 日本語\nconst PROBE = 1\n')).toBe(1)
	})

	it('flags a Japanese test title', () => {
		expect(count("it('日本語', () => {})\n")).toBe(1)
	})

	it('leaves an English comment and Japanese data alone', () => {
		expect(count("// English\nconst LABEL = '日本語のデータ'\n")).toBe(0)
	})
})
