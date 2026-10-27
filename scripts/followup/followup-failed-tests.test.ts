import { describe, expect, it } from 'vitest'
import {
	followup_failed_tests,
	KEPT_VERDICT,
	OBSERVATION_SLUG,
	RERUN_VERDICT,
	UNNAMED_VERDICT,
} from './followup-failed-tests'

const STAMP = '2026-10-27T10:00:00.1234567Z '
const BUDGET_TEST = 'scripts/run/board/run-board-frame-budget.test.ts'
const CLAIM_TEST = 'scripts/test/test-related.claim.test.ts'
const CLAIM_SUBJECT = 'scripts/test/test-related.ts'
const BUDGET_NAME = `${BUDGET_TEST} > frame budget > reads the budget`
const CLAIM_NAME = `|isolated| ${CLAIM_TEST} > claim > holds`

function tests_of(...files: Array<string>): { files: Array<string>; names: Array<string> } {
	return { files, names: files.map((file) => `${file} > suite > test`) }
}

describe('followup_failed_tests.read_failed_tests', () => {
	it('reads the failed tests from a GitHub Actions log, timestamps and project labels included', () => {
		const log = [
			`${STAMP}::group::Run pnpm josh test:unit --shard=5/6`,
			`${STAMP} FAIL  ${BUDGET_NAME}`,
			`${STAMP}\u{1B}[31m FAIL \u{1B}[39m ${CLAIM_NAME}`,
			`${STAMP} FAIL  ${BUDGET_NAME}`,
		].join('\n')

		expect(followup_failed_tests.read_failed_tests(log)).toStrictEqual({
			files: [BUDGET_TEST, CLAIM_TEST],
			names: [BUDGET_NAME, CLAIM_NAME],
		})
	})

	it('reads nothing from a job that failed on anything but a test', () => {
		const log = `${STAMP}Error: eslint found 2 problems\n${STAMP}##[error]Process completed with exit code 1.`

		expect(followup_failed_tests.read_failed_tests(log)).toStrictEqual({ files: [], names: [] })
	})
})

describe('followup_failed_tests.subjects_of', () => {
	it('names the test file and the module each leading run of its segments names', () => {
		expect(followup_failed_tests.subjects_of(CLAIM_TEST)).toStrictEqual([
			CLAIM_TEST,
			CLAIM_SUBJECT,
			'scripts/test/test-related.claim.ts',
		])
	})

	it('names only the file itself when it is not a test file', () => {
		const script = 'tools/check.sh'

		expect(followup_failed_tests.subjects_of(script)).toStrictEqual([script])
	})
})

describe('followup_failed_tests.verdict_of', () => {
	it('reruns when no failed test or its subject moved', () => {
		const changed = new Set(['scripts/followup/followup-job-rerun.ts'])
		const tests = tests_of(BUDGET_TEST, CLAIM_TEST)

		expect(followup_failed_tests.verdict_of(tests, changed)).toBe(RERUN_VERDICT)
	})

	it.each([
		['the test file itself', BUDGET_TEST],
		['its subject module', CLAIM_SUBJECT],
	])('keeps the failure when one failed test belongs to the change through %s', (_label, moved) => {
		const tests = tests_of(BUDGET_TEST, CLAIM_TEST)

		expect(followup_failed_tests.verdict_of(tests, new Set([moved]))).toBe(KEPT_VERDICT)
	})

	it('answers unnamed when the log named no failed test', () => {
		expect(followup_failed_tests.verdict_of(tests_of(), new Set())).toBe(UNNAMED_VERDICT)
	})
})

describe('followup_failed_tests.observation_of', () => {
	it('names the reran jobs, the failed files and each test once, with no field separator inside', () => {
		const entry = followup_failed_tests.observation_of([
			{ job: 'Unit Tests (5/6)', tests: { files: [CLAIM_TEST], names: [CLAIM_NAME] } },
			{ job: 'Unit Tests (2/6)', tests: { files: [CLAIM_TEST], names: [CLAIM_NAME] } },
		])

		expect(entry).toStrictEqual({
			slug: OBSERVATION_SLUG,
			depth: 'd1',
			where: CLAIM_TEST,
			what: `followup reran Unit Tests (5/6), Unit Tests (2/6); failed outside the change: /isolated/ ${CLAIM_TEST} > claim > holds`,
		})
	})
})
