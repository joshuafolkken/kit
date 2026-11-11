import { describe, expect, it } from 'vitest'
import { issue_wip } from './issue-wip'

// joshuafolkken/kit#3181: `josh issue:file` counts the target's open Issues against the WIP cap and
// holds a filing past it unless the route or `--over-cap` declares it exempt.

const CAP = issue_wip.DEFAULT_WIP_CAP
const OVER = CAP + 1
const OVERRIDE = 200
const REPO = 'joshuafolkken/kit'
const NO_ROUTE = { route: undefined, is_over_cap: false }

describe('issue_wip.verdict_of — the cap against the count', () => {
	it('is within at exactly the cap', () => {
		expect(issue_wip.verdict_of(CAP, NO_ROUTE, CAP)).toBe('within')
	})

	it('holds a filing past the cap with no exemption declared', () => {
		expect(issue_wip.verdict_of(OVER, NO_ROUTE, CAP)).toBe(issue_wip.HELD)
	})

	it('holds the review cap branch-2 route, which is discretionary', () => {
		expect(issue_wip.verdict_of(OVER, { route: 'route:review-cap', is_over_cap: false }, CAP)).toBe(
			issue_wip.HELD,
		)
	})

	it.each(['route:tier-a', 'route:split', 'route:interrupt'])('exempts %s', (route) => {
		expect(issue_wip.verdict_of(OVER, { route, is_over_cap: false }, CAP)).toBe('exempt')
	})

	it('exempts a filing declared with --over-cap', () => {
		expect(issue_wip.verdict_of(OVER, { route: undefined, is_over_cap: true }, CAP)).toBe('exempt')
	})

	it('is within under a raised cap', () => {
		expect(issue_wip.verdict_of(OVER, NO_ROUTE, OVERRIDE)).toBe('within')
	})

	it('is within at any count when the cap is off', () => {
		expect(issue_wip.verdict_of(OVERRIDE, NO_ROUTE, issue_wip.CAP_OFF)).toBe('within')
	})
})

function read(value: string | undefined): ReturnType<typeof issue_wip.read_cap> {
	return issue_wip.read_cap({ [issue_wip.WIP_CAP_KEY]: value })
}

describe('issue_wip.read_cap — JOSH_WIP_CAP', () => {
	it.each([undefined, '', '  '])('reads %j as the default cap', (value) => {
		expect(read(value)).toStrictEqual({ kind: 'cap', cap: CAP })
	})

	it('reads a positive integer as the cap', () => {
		expect(read(String(OVERRIDE))).toStrictEqual({ kind: 'cap', cap: OVERRIDE })
	})

	it.each(['off', 'OFF', ' Off '])('reads %j as the cap turned off', (value) => {
		expect(read(value)).toStrictEqual({ kind: 'cap', cap: issue_wip.CAP_OFF })
	})

	it.each(['0', '-5', 'thirty', '1.5'])('refuses %j by name, not as the default', (value) => {
		expect(read(value)).toStrictEqual({
			kind: 'problem',
			problem: expect.stringContaining(issue_wip.WIP_CAP_KEY),
		})
	})
})

describe('issue_wip.count_line and count_of', () => {
	it('prints the count, the repository, the cap and the verdict', () => {
		expect(issue_wip.count_line(OVER, REPO, issue_wip.HELD, CAP)).toBe(
			`wip: ${String(OVER)} open in ${REPO} · cap ${String(CAP)} · held`,
		)
	})

	it('prints a cap turned off as off', () => {
		expect(issue_wip.count_line(OVER, REPO, 'within', issue_wip.CAP_OFF)).toBe(
			`wip: ${String(OVER)} open in ${REPO} · cap off · within`,
		)
	})

	it('counts the rows of a listing', () => {
		expect(issue_wip.count_of('[{"number":1},{"number":2}]')).toBe(2)
	})

	it.each(['{}', 'not json'])('reads %j as unreadable rather than zero', (json) => {
		expect(issue_wip.count_of(json)).toBeUndefined()
	})
})

describe('issue_wip.HELD_MESSAGE — the exemption question', () => {
	it.each([
		'close one first',
		'nothing honestly closable means do not file',
		'a verification answers wrongly',
		'a documented workflow cannot complete',
		'data is lost or written outside the repository',
		'--route interrupt',
		'--over-cap',
		'prompts/collaboration-workflow/wip-cap.md',
	])('states %j', (marker) => {
		expect(issue_wip.HELD_MESSAGE).toContain(marker)
	})
})
