import { describe, expect, it } from 'vitest'
import {
	CHECK_STATUS_FAIL,
	CHECK_STATUS_MISSING,
	CHECK_STATUS_PASS,
	CHECK_STATUS_PENDING,
	parse_json_safe,
	parse_rollup_checks,
	read_string,
} from './git-pr-checks-parse'

const CODE_RABBIT = 'CodeRabbit'
const SONAR_QUBE = 'SonarQube'
const NON_STRING_VALUE = 'not a string'

describe('read_string', () => {
	it('returns the trimmed string for a non-empty value', () => {
		expect(read_string('  hello  ')).toBe('hello')
	})

	it('returns undefined for an empty string', () => {
		expect(read_string('')).toBeUndefined()
	})

	it('returns undefined for a whitespace-only string', () => {
		expect(read_string('   ')).toBeUndefined()
	})

	it('returns undefined for a number', () => {
		expect(read_string(42)).toBeUndefined()
	})

	it('returns undefined for undefined', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined input
		expect(read_string(undefined)).toBeUndefined()
	})
})

describe('parse_json_safe', () => {
	it('parses valid JSON object', () => {
		expect(parse_json_safe('{"key":"value"}')).toStrictEqual({ key: 'value' })
	})

	it('parses valid JSON array', () => {
		expect(parse_json_safe('[1,2,3]')).toStrictEqual([1, 2, 3])
	})

	it('returns undefined for invalid JSON', () => {
		expect(parse_json_safe(NON_STRING_VALUE)).toBeUndefined()
	})

	it('returns undefined for empty string', () => {
		expect(parse_json_safe('')).toBeUndefined()
	})
})

function check_run_item(name: string): Record<string, string> {
	return {
		// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
		__typename: 'CheckRun',
		name,
		status: 'COMPLETED',
		conclusion: 'SUCCESS',
	}
}

function status_context_item(context: string, state: string): Record<string, string> {
	return {
		// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
		__typename: 'StatusContext',
		context,
		state,
	}
}

describe('parse_rollup_checks — CheckRun items', () => {
	it('returns pass for a completed successful CheckRun', () => {
		const raw = JSON.stringify({ statusCheckRollup: [check_run_item(CODE_RABBIT)] })
		const checks = parse_rollup_checks(raw)

		expect(checks).toHaveLength(1)
		expect(checks[0]).toStrictEqual({ name: CODE_RABBIT, status: CHECK_STATUS_PASS })
	})

	it('returns pending for an in-progress CheckRun', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [{ name: SONAR_QUBE, status: 'IN_PROGRESS' }],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks[0]?.status).toBe(CHECK_STATUS_PENDING)
	})

	it('returns fail for a completed CheckRun with failure conclusion', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [{ name: CODE_RABBIT, status: 'COMPLETED', conclusion: 'FAILURE' }],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks[0]?.status).toBe(CHECK_STATUS_FAIL)
	})
})

describe('parse_rollup_checks — StatusContext items', () => {
	it('returns pass for a SUCCESS StatusContext', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [status_context_item(CODE_RABBIT, 'SUCCESS')],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks[0]?.status).toBe(CHECK_STATUS_PASS)
	})

	it('returns pending for a PENDING StatusContext', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [status_context_item(CODE_RABBIT, 'PENDING')],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks[0]?.status).toBe(CHECK_STATUS_PENDING)
	})

	it('returns fail for an ERROR StatusContext', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [status_context_item(CODE_RABBIT, 'ERROR')],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks[0]?.status).toBe(CHECK_STATUS_FAIL)
	})
})

describe('parse_rollup_checks — edge cases', () => {
	it('skips items with no name or context', () => {
		const raw = JSON.stringify({ statusCheckRollup: [{ status: 'COMPLETED' }] })

		expect(parse_rollup_checks(raw)).toHaveLength(0)
	})

	it('returns empty array for invalid JSON', () => {
		expect(parse_rollup_checks(NON_STRING_VALUE)).toStrictEqual([])
	})

	it('returns empty array when statusCheckRollup is missing', () => {
		expect(parse_rollup_checks('{}')).toStrictEqual([])
	})

	it('parses multiple checks in one payload', () => {
		const raw = JSON.stringify({
			statusCheckRollup: [check_run_item(CODE_RABBIT), check_run_item(SONAR_QUBE)],
		})
		const checks = parse_rollup_checks(raw)

		expect(checks).toHaveLength(2)
		expect(checks[0]?.name).toBe(CODE_RABBIT)
		expect(checks[1]?.name).toBe(SONAR_QUBE)
	})
})

describe('CHECK_STATUS constants', () => {
	it('has correct pass value', () => {
		expect(CHECK_STATUS_PASS).toBe('pass')
	})

	it('has correct pending value', () => {
		expect(CHECK_STATUS_PENDING).toBe('pending')
	})

	it('has correct fail value', () => {
		expect(CHECK_STATUS_FAIL).toBe('fail')
	})

	it('has correct missing value', () => {
		expect(CHECK_STATUS_MISSING).toBe('missing')
	})
})
