import { describe, expect, it } from 'vitest'
import { removed_test_files } from './removed-test-files'

// joshuafolkken/kit#8927: a test file the change deleted whole is disposed of by one row naming it.

const GONE = 'src/gone.test.ts'
const KEPT = 'src/kept.test.ts'
const SHARED = 'shared > returns undefined'
const ONLY_GONE = 'gone > draws the frame'
const ONLY_KEPT = 'kept > reads the table'

const BASE = [
	{ path: GONE, titles: [ONLY_GONE, SHARED] },
	{ path: KEPT, titles: [ONLY_KEPT, SHARED] },
]

function is_gone(relative: string): boolean {
	return relative === GONE
}

describe('removed_test_files.wholly_removed', () => {
	it('lists only the deleted file, without a title a kept file also holds', () => {
		expect(removed_test_files.wholly_removed(BASE, is_gone)).toStrictEqual([
			{ path: GONE, titles: [ONLY_GONE] },
		])
	})

	it('lists nothing when every changed file is kept', () => {
		expect(removed_test_files.wholly_removed(BASE, () => false)).toStrictEqual([])
	})
})

describe('removed_test_files.disposed_by', () => {
	const files = [{ path: GONE, titles: [ONLY_GONE] }]

	it('disposes of every title of a named deleted file', () => {
		expect(removed_test_files.disposed_by(new Set([GONE]), files)).toStrictEqual(
			new Set([GONE, ONLY_GONE]),
		)
	})

	it('adds nothing for a name that is no deleted file', () => {
		expect(removed_test_files.disposed_by(new Set([KEPT]), files)).toStrictEqual(new Set([KEPT]))
	})
})

describe('removed_test_files.pending_names', () => {
	const SOUND = 'gone > plays the sound'
	const files = [{ path: GONE, titles: [ONLY_GONE, SOUND] }]

	it('gathers the open titles of a deleted file under its path, once (ac-3b71a395)', () => {
		expect(removed_test_files.pending_names([ONLY_GONE, SOUND, SHARED], files)).toStrictEqual([
			GONE,
			SHARED,
		])
	})

	it('keeps a renamed title of a deleted file as a row of its own', () => {
		expect(
			removed_test_files.pending_names([ONLY_GONE, SOUND], files, new Set([SOUND])),
		).toStrictEqual([GONE, SOUND])
	})

	it('names no file whose open titles are all renamed', () => {
		expect(
			removed_test_files.pending_names([ONLY_GONE, SOUND], files, new Set([ONLY_GONE, SOUND])),
		).toStrictEqual([ONLY_GONE, SOUND])
	})

	it('leaves out a deleted file none of whose titles is open', () => {
		expect(removed_test_files.pending_names([SHARED], files)).toStrictEqual([SHARED])
	})
})
