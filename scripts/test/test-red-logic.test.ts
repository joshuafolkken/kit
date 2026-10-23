import { observation_ledger } from '#scripts/observations/observation-ledger'
import { describe, expect, it } from 'vitest'
import { test_red_logic } from './test-red-logic'

const BUG_BODY = '## 背景\n\n- 種別: 不具合\n\nThe symptom came back.\n'
const BEHAVIOR_BODY = '## 背景\n\n- 種別: 振る舞い変更\n'
const UNIT_TEST = 'scripts/a.test.ts'
const RUNTIME_FILE = 'scripts/a.ts'
const E2E_SPEC = 'src/page.e2e.ts'
const LEDGER_ENTRY = observation_ledger.ledger_file(3208)

describe('test_red_logic.is_bug_fix', () => {
	it('reads the bug declaration line', () => {
		expect(test_red_logic.is_bug_fix(BUG_BODY)).toBe(true)
	})

	it('ignores a body with another declaration or a mention inside a sentence', () => {
		expect(test_red_logic.is_bug_fix(BEHAVIOR_BODY)).toBe(false)
		expect(test_red_logic.is_bug_fix('This is not `- 種別: 不具合` on its own line')).toBe(false)
	})
})

describe('test_red_logic.unit_test_files', () => {
	it('keeps the Vitest files and drops runtime files and E2E specs', () => {
		const unit_tests = [UNIT_TEST, 'src/Page.svelte.test.ts']
		const paths = [RUNTIME_FILE, ...unit_tests, E2E_SPEC]

		expect(test_red_logic.unit_test_files(paths)).toEqual(unit_tests)
	})
})

describe('test_red_logic.is_test_only', () => {
	it('is true when every changed path is a test file', () => {
		expect(test_red_logic.is_test_only(['scripts/lint/lint-related.test.ts'])).toBe(true)
		expect(test_red_logic.is_test_only([UNIT_TEST, E2E_SPEC])).toBe(true)
	})

	it('is false once a runtime file changed beside the test', () => {
		expect(test_red_logic.is_test_only([UNIT_TEST, RUNTIME_FILE])).toBe(false)
	})

	it('is false once an exempt file a document-rule test reads changed beside the test', () => {
		expect(test_red_logic.is_test_only([UNIT_TEST, 'docs/a.md'])).toBe(false)
		expect(test_red_logic.is_test_only([UNIT_TEST, 'prompts/a.md'])).toBe(false)
	})

	it('ignores the observation ledger entry a run commits beside the test', () => {
		expect(test_red_logic.is_test_only([UNIT_TEST, LEDGER_ENTRY])).toBe(true)
		expect(test_red_logic.is_test_only([UNIT_TEST, LEDGER_ENTRY, 'docs/a.md'])).toBe(false)
	})

	it('is false when only the observation ledger changed', () => {
		expect(test_red_logic.is_test_only([LEDGER_ENTRY])).toBe(false)
	})
})

describe('test_red_logic.ran_file_count', () => {
	it('counts the files the JSON report says ran', () => {
		const report = JSON.stringify({ numTotalTests: 0, testResults: [{}, {}] })

		expect(test_red_logic.ran_file_count(report)).toBe(2)
	})

	it('counts zero for an empty, malformed or unexpected report', () => {
		expect(test_red_logic.ran_file_count(JSON.stringify({ testResults: [] }))).toBe(0)
		expect(test_red_logic.ran_file_count('')).toBe(0)
		expect(test_red_logic.ran_file_count('{"testResults":')).toBe(0)
		expect(test_red_logic.ran_file_count(JSON.stringify({ success: true }))).toBe(0)
	})
})

describe('test_red_logic.verdict_for', () => {
	it('answers no-test when nothing ran, red on a failure and green on a pass', () => {
		expect(test_red_logic.verdict_for(0, false)).toBe('no-test')
		expect(test_red_logic.verdict_for(2, true)).toBe('red')
		expect(test_red_logic.verdict_for(2, false)).toBe('green')
	})
})

describe('test_red_logic.is_refused', () => {
	it('refuses only a green verdict on a declared bug fix', () => {
		expect(test_red_logic.is_refused(BUG_BODY, 'green')).toBe(true)
		expect(test_red_logic.is_refused(BUG_BODY, 'red')).toBe(false)
		expect(test_red_logic.is_refused(BUG_BODY, 'no-test')).toBe(false)
		expect(test_red_logic.is_refused(BUG_BODY, 'test-only')).toBe(false)
		expect(test_red_logic.is_refused(BEHAVIOR_BODY, 'green')).toBe(false)
	})
})
