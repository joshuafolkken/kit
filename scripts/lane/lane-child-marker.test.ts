import { describe, expect, it } from 'vitest'
import { lane_child_marker } from './lane-child-marker'

// joshuafolkken/kit#1904: the mark is what makes the pre-gate cut and a resume mechanical rather than
// the model's to guess, so this suite pins its two halves — composing the mark from a validated issue
// number, and reading it back without trusting a blank, malformed, or leaked value.

const ISSUE = '1904'

describe('env_for', () => {
	it('carries the issue number under the marker key', () => {
		expect(lane_child_marker.env_for(ISSUE)).toStrictEqual({ [lane_child_marker.KEY]: ISSUE })
	})

	// The mark is composed from a digits-only issue number, so a malformed one fails here rather than
	// reaching a child that would read it as absent.
	it.each([['0'], ['abc'], [''], ['12 34'], ['-5']])('refuses %j as an issue number', (issue) => {
		expect(() => lane_child_marker.env_for(issue)).toThrow()
	})
})

describe('marked_issue', () => {
	it('reads back a valid issue number', () => {
		expect(lane_child_marker.marked_issue({ [lane_child_marker.KEY]: ISSUE })).toBe(ISSUE)
	})

	it('reads an absent mark as undefined', () => {
		expect(lane_child_marker.marked_issue({})).toBeUndefined()
	})

	// A blank or non-numeric value is read as absent rather than trusted, so neither a hand-set variable
	// nor a leaked one can stand in for a real dispatch.
	it.each([[''], ['abc'], ['0'], ['1904 '], ['#1904']])(
		'reads a malformed value %j as undefined',
		(value) => {
			expect(lane_child_marker.marked_issue({ [lane_child_marker.KEY]: value })).toBeUndefined()
		},
	)
})

describe('is_child_of', () => {
	// The lane issue is read from the checkout path, and the mark is trusted only where it names that
	// issue — so a leaked mark for a different lane reads as a person's run (joshuafolkken/kit#1947).
	const LANE = `/home/dev/.kit-lanes/${ISSUE}`

	it('is true when the mark names the checkout own lane issue', () => {
		expect(lane_child_marker.is_child_of(LANE, { [lane_child_marker.KEY]: ISSUE })).toBe(true)
	})

	it('is false when the mark names a different issue, so a leaked variable reads as a person', () => {
		expect(lane_child_marker.is_child_of(LANE, { [lane_child_marker.KEY]: '9999' })).toBe(false)
	})

	it('is false when the mark is absent', () => {
		expect(lane_child_marker.is_child_of(LANE, {})).toBe(false)
	})

	it('is false in a checkout that is not a lane, whatever the mark says', () => {
		expect(
			lane_child_marker.is_child_of('/home/dev/repo', { [lane_child_marker.KEY]: ISSUE }),
		).toBe(false)
	})
})
