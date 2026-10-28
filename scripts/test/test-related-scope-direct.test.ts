import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_scope, type ScopeRequest } from './test-related-scope'

// joshuafolkken/kit#5122: a moved file every test imports narrows to the test files importing it
// directly, where `vitest related` would run the whole suite; the gate and CI run that once.

const ROOT = path.resolve('/repo')
const EVERY_TEST_MODULE = 'tools/test/unit-projects.ts'
const UNIMPORTED_MODULE = 'tools/test/pure-files.ts'
const DIRECT_TESTS = ['tools/test/unit-projects.test.ts', 'scripts/test/vitest-config.test.ts']
const OTHER_MODULE = 'scripts/test/unit-worker-share.ts'
const ROOT_FILE = 'vitest.config.ts'

function request(
	changed: ReadonlyArray<string>,
	importers: ReadonlyMap<string, ReadonlyArray<string>>,
): ScopeRequest {
	return {
		root: ROOT,
		changed,
		map: undefined,
		recorded: new Set(),
		is_present: () => true,
		every_test_importers: importers,
	}
}

function absolute(files: ReadonlyArray<string>): Array<string> {
	return files.map((file) => path.join(ROOT, file))
}

describe('related_scope.resolve_scope with a file every test imports', () => {
	it('selects only the test files importing it directly', () => {
		const importers = new Map([[EVERY_TEST_MODULE, DIRECT_TESTS]])
		const scope = related_scope.resolve_scope(request([EVERY_TEST_MODULE], importers))

		expect(scope).toEqual({
			mode: 'related',
			files: absolute(DIRECT_TESTS),
			reason: `${String(DIRECT_TESTS.length)} related file(s)`,
		})
	})

	it('joins those test files to the rest of the change', () => {
		const importers = new Map([[EVERY_TEST_MODULE, DIRECT_TESTS]])
		const scope = related_scope.resolve_scope(request([OTHER_MODULE, EVERY_TEST_MODULE], importers))

		expect(scope.files).toEqual(absolute([OTHER_MODULE, ...DIRECT_TESTS]))
	})

	it('runs no test when no test imports it directly', () => {
		const scope = related_scope.resolve_scope(
			request([UNIMPORTED_MODULE], new Map([[UNIMPORTED_MODULE, []]])),
		)

		expect(scope.mode).toBe('none')
		expect(scope.files).toEqual(absolute([UNIMPORTED_MODULE]))
	})

	it('still runs the whole suite for a root file beside it', () => {
		const importers = new Map([[EVERY_TEST_MODULE, DIRECT_TESTS]])
		const scope = related_scope.resolve_scope(request([ROOT_FILE, EVERY_TEST_MODULE], importers))

		expect(scope.mode).toBe('all')
		expect(scope.files).toEqual(absolute([ROOT_FILE]))
	})

	it('runs the whole suite when its importers were not read', () => {
		const scope = related_scope.resolve_scope(request([EVERY_TEST_MODULE], new Map()))

		expect(scope.mode).toBe('all')
	})
})
