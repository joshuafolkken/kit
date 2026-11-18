import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReadMap } from './test-read-map'
import { related_scope, type ScopeRequest } from './test-related-scope'

// joshuafolkken/kit#7978: a changed document reaches the test files naming its path as well as the
// ones the read map recorded, so a document the map holds no reader of runs the found ones rather than
// the whole suite.

const ROOT = path.resolve('/repo')
const RECORDED_DOCUMENT = path.join('docs', 'thing.md')
// Added since the recorded tree beside a document a test read, so no reader at all says nothing.
const NEW_DOCUMENT = path.join('docs', 'added.md')
const RECORDED_READER = path.join('scripts', 'listing.test.ts')
const NAMING_READER = path.join('scripts', 'naming.test.ts')

const MAP: ReadMap = {
	version: 1,
	commit: 'abc',
	dirty: {},
	change: [],
	directories: ['docs', 'scripts'],
	readers: { [RECORDED_DOCUMENT]: [RECORDED_READER] },
}

function request(
	changed: ReadonlyArray<string>,
	searched: ReadonlyMap<string, ReadonlyArray<string>>,
): ScopeRequest {
	return {
		root: ROOT,
		changed,
		map: MAP,
		recorded: new Set(),
		is_present: () => true,
		searched_readers: searched,
	}
}

describe('related_scope.resolve_scope with the readers found by path', () => {
	it('selects a found reader of a document the map holds no record of', () => {
		const searched = new Map([[NEW_DOCUMENT, [NAMING_READER]]])
		const scope = related_scope.resolve_scope(request([NEW_DOCUMENT], searched))

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([path.join(ROOT, NAMING_READER)])
	})

	it('selects the recorded readers beside the found ones', () => {
		const searched = new Map([[RECORDED_DOCUMENT, [NAMING_READER]]])
		const scope = related_scope.resolve_scope(request([RECORDED_DOCUMENT], searched))

		expect(scope.files).toEqual([path.join(ROOT, RECORDED_READER), path.join(ROOT, NAMING_READER)])
	})

	it('keeps a recorded reader that names no path', () => {
		const scope = related_scope.resolve_scope(request([RECORDED_DOCUMENT], new Map()))

		expect(scope.files).toEqual([path.join(ROOT, RECORDED_READER)])
	})

	it('falls back only when neither kind of reader reaches a new document', () => {
		const scope = related_scope.resolve_scope(request([NEW_DOCUMENT], new Map()))

		expect(scope.mode).toBe('all')
	})
})
