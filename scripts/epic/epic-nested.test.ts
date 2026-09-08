import { EPIC_LABEL, IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_nested } from './epic-nested'

// joshuafolkken/kit#1476. The four combinations below are the whole point of the module: pointing at
// an epic and pointing into another repository are independent properties, and only the first one
// withholds a row. A cross-repository row is legitimate — it disables the epic auto-close by design —
// so a test that collapsed the two would refuse the shape `CLAUDE.md` asks for.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'

function child(labels: ReadonlyArray<string>, repo = REPO): EpicChild {
	return { number: 1, repo, state: 'OPEN', labels, blocked_by: [] }
}

describe('epic_nested.is_nested_epic', () => {
	it('answers yes for a child carrying the epic label', () => {
		expect(epic_nested.is_nested_epic(child([EPIC_LABEL]))).toBe(true)
	})

	it('answers no for an ordinary child', () => {
		expect(epic_nested.is_nested_epic(child([IN_PROGRESS_LABEL]))).toBe(false)
	})

	it('answers no for a child in another repository that is not an epic', () => {
		expect(epic_nested.is_nested_epic(child([], OTHER_REPO))).toBe(false)
	})

	it('answers yes for a child in another repository that is an epic', () => {
		expect(epic_nested.is_nested_epic(child([EPIC_LABEL], OTHER_REPO))).toBe(true)
	})

	it('matches the label whatever casing the repository created it with', () => {
		expect(epic_nested.is_nested_epic(child(['Epic']))).toBe(true)
	})

	it('answers no for a child with no labels at all', () => {
		expect(epic_nested.is_nested_epic(child([]))).toBe(false)
	})
})
