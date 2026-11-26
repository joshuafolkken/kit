import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { describe, expect, it } from 'vitest'
import { run_board_kind } from './run-board-kind'

// joshuafolkken/kit#3577: a row's release category, read from its labels as `.github/release.yml`
// sorts a change.

const BREAKING: FiledKind = 'breaking-change'
const FEATURE: FiledKind = 'enhancement'
const FIX: FiledKind = 'bug'

describe('run_board_kind.kind_of', () => {
	it.each([
		[BREAKING, BREAKING],
		[FEATURE, FEATURE],
		['bugfix', FIX],
		[FIX, FIX],
		['Bug', FIX],
	])('reads %s as %s', (label, kind) => {
		expect(run_board_kind.kind_of([label, 'auto-ok'])).toBe(kind)
	})

	it('takes the first category in the release notes’ order where several apply', () => {
		expect(run_board_kind.kind_of([FIX, FEATURE])).toBe(FEATURE)
		expect(run_board_kind.kind_of(['bugfix', FEATURE, BREAKING])).toBe(BREAKING)
	})

	// joshuafolkken/kit#4109: the retired Semver-* aliases place a row in no category.
	it.each(['Semver-Major', 'Semver-Minor'])('reads the retired %s as no kind', (label) => {
		expect(run_board_kind.kind_of([label, 'auto-ok'])).toBeUndefined()
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

// joshuafolkken/kit#8960: a row's area, the word after `area:` of its first area label.
const AREA_BOARD = 'area:board'
const AREA_THEME = 'area:theme'

describe('run_board_kind.area_of', () => {
	it.each([
		[AREA_BOARD, 'board'],
		[AREA_THEME, 'theme'],
		['Area:dashboard', 'dashboard'],
	])('reads the label %s as the area %s', (label, area) => {
		expect(run_board_kind.area_of([FEATURE, label])).toBe(area)
	})

	it('takes the first area where several apply', () => {
		expect(run_board_kind.area_of([AREA_THEME, AREA_BOARD])).toBe('theme')
	})

	it('reads the kind, priority and area of a row together', () => {
		expect(run_board_kind.marks_of([FEATURE, 'priority:high', AREA_BOARD])).toStrictEqual({
			kind: FEATURE,
			priority: 'high',
			area: 'board',
		})
	})

	it('reads no area where none applies, or where labels are not read', () => {
		expect(run_board_kind.area_of([FEATURE, 'auto-ok'])).toBeUndefined()
		expect(run_board_kind.area_of(['area:'])).toBeUndefined()
		expect(run_board_kind.area_of([])).toBeUndefined()
		expect(run_board_kind.area_of(undefined)).toBeUndefined()
	})
})
