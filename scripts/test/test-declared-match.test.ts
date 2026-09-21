import { describe, expect, it } from 'vitest'
import { test_declared_match } from './test-declared-match'

// joshuafolkken/kit#2181: the Step 0 declaration line is cross-checked against the change set, so the
// four outcomes are pinned — match / type-mismatch / path-missing / test-not-created.

const RUNTIME_FILE = 'scripts/foo.ts'
const UNIT_TEST_FILE = 'scripts/foo.test.ts'
const ROUTE_FILE = 'src/routes/foo/+page.svelte'
const UNIT_LINE = `Extract helper — Test: Unit — ${RUNTIME_FILE} — verifies the helper`
const E2E_LINE = `New page — Test: E2E — ${ROUTE_FILE} — verifies the page`
const TEST_NOT_CREATED = 'test-not-created'

function status_of(summary: string, changed: ReadonlyArray<string>): string | undefined {
	return test_declared_match.match_report(summary, changed)[0]?.status
}

describe('test_declared_match.parse_declarations', () => {
	it('reads the declared type and path from a Test: line', () => {
		expect(test_declared_match.parse_declarations(UNIT_LINE)).toStrictEqual([
			{ declared_type: 'Unit', path: RUNTIME_FILE },
		])
	})

	it('ignores lines with no Test: field', () => {
		expect(test_declared_match.parse_declarations('■ 概要\n- plain prose line')).toStrictEqual([])
	})

	it('ignores a Test: field naming an unknown type', () => {
		expect(
			test_declared_match.parse_declarations(`x — Test: Smoke — ${RUNTIME_FILE} — y`),
		).toStrictEqual([])
	})
})

describe('test_declared_match.match_report', () => {
	it('matches a declared unit test that was added beside the runtime file', () => {
		expect(status_of(UNIT_LINE, [RUNTIME_FILE, UNIT_TEST_FILE])).toBe('match')
	})

	it('matches a declared e2e test in the route directory', () => {
		expect(status_of(E2E_LINE, [ROUTE_FILE, 'src/routes/foo/page.e2e.ts'])).toBe('match')
	})

	it('is path-missing when the declared path was not changed', () => {
		expect(status_of(UNIT_LINE, ['scripts/other.ts', 'scripts/other.test.ts'])).toBe('path-missing')
	})

	it('is type-mismatch when the declared type differs from the path', () => {
		const line = `New page — Test: Unit — ${ROUTE_FILE} — wrong type`

		expect(status_of(line, [ROUTE_FILE, 'src/routes/foo/x.test.ts'])).toBe('type-mismatch')
	})

	it('is test-not-created when no colocated test of the type is in the diff', () => {
		expect(status_of(UNIT_LINE, [RUNTIME_FILE])).toBe(TEST_NOT_CREATED)
	})

	it('is test-not-created when the only test is in another directory', () => {
		expect(status_of(UNIT_LINE, [RUNTIME_FILE, 'scripts/sub/bar.test.ts'])).toBe(TEST_NOT_CREATED)
	})
})

describe('test_declared_match.directory_of', () => {
	it('keeps the trailing slash of a nested path', () => {
		expect(test_declared_match.directory_of('scripts/a/b.ts')).toBe('scripts/a/')
	})

	it('is empty for a root-level path', () => {
		expect(test_declared_match.directory_of('foo.ts')).toBe('')
	})
})
