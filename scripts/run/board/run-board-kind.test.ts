import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { describe, expect, it } from 'vitest'
import { run_board_kind } from './run-board-kind'

// joshuafolkken/kit#3577: a row's release category, read from its labels as `.github/release.yml`
// sorts a change.

const BREAKING: FiledKind = 'breaking-change'
const FEATURE: FiledKind = 'enhancement'
const FIX: FiledKind = 'bug'
const SEMVER_MAJOR = 'Semver-Major'

describe('run_board_kind.kind_of', () => {
	it.each([
		[BREAKING, BREAKING],
		[SEMVER_MAJOR, BREAKING],
		[FEATURE, FEATURE],
		['Semver-Minor', FEATURE],
		['bugfix', FIX],
		[FIX, FIX],
		['Bug', FIX],
	])('reads %s as %s', (label, kind) => {
		expect(run_board_kind.kind_of([label, 'auto-ok'])).toBe(kind)
	})

	it('takes the first category in the release notes’ order where several apply', () => {
		expect(run_board_kind.kind_of([FIX, FEATURE])).toBe(FEATURE)
		expect(run_board_kind.kind_of(['bugfix', FEATURE, SEMVER_MAJOR])).toBe(BREAKING)
	})

	it('reads no kind for an Other Change, or for labels not read', () => {
		expect(run_board_kind.kind_of(['other-change', 'auto-ok'])).toBeUndefined()
		expect(run_board_kind.kind_of([])).toBeUndefined()
		expect(run_board_kind.kind_of(undefined)).toBeUndefined()
	})

	it('orders the kinds as the release notes do', () => {
		expect(run_board_kind.KIND_ORDER).toStrictEqual([BREAKING, FEATURE, FIX])
	})
})
