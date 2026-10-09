import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { stash_orphans } from './stash-orphans'

// joshuafolkken/kit#2505: which issue a stash belongs to is read from its subject, and only the entries
// whose issue closed — or that name none — are put in front of a person.

const PARKED = { selector: 'stash@{0}', subject: 'On main: backlogrun: parked #2346' }
const WORK = { selector: 'stash@{1}', subject: 'On main: 2370: opt-out version of the switch' }
const LANE = { selector: 'stash@{2}', subject: 'On 2346-lane: setup-cut implementation' }
const OPEN = { selector: 'stash@{3}', subject: 'On main: 2505: uncommitted work at close' }
const OWNERLESS = {
	selector: 'stash@{4}',
	subject: 'On main: backlogrun: josh latest before lanes',
}

describe('stash_orphans.issue_of — the owning issue read from a stash subject', () => {
	it.each([
		['backlogrun: parked #N', PARKED.subject, '2346'],
		['a message opening with N:', WORK.subject, '2370'],
		['an N-lane branch', LANE.subject, '2346'],
		['a message pushed with no branch context', '2370: opt-out', '2370'],
		['a WIP entry on an N-lane branch', 'WIP on 2346-lane: abc1234 message', '2346'],
	])('reads %s', (_label, subject, expected) => {
		expect(stash_orphans.issue_of(subject)).toBe(expected)
	})

	it('never reads the owner from the HEAD commit subject a stash without -m carries', () => {
		expect(stash_orphans.issue_of('WIP on 2505-lane: 0ada820 Treat a read as failed #2503')).toBe(
			'2505',
		)
		expect(stash_orphans.issue_of('WIP on main: d360544 Merge pull request #2506')).toBeUndefined()
	})

	it('reads no issue from a subject that names none', () => {
		expect(stash_orphans.issue_of(OWNERLESS.subject)).toBeUndefined()
		expect(stash_orphans.issue_of('On main: fix 2 things')).toBeUndefined()
	})

	it('reads no owner from a run:hold reclaim, whose #N is the run that found the work', () => {
		expect(stash_orphans.issue_of('On 2400-lane: run:hold reclaimed before #2401')).toBeUndefined()
	})
})

describe('stash_orphans.issues_of — each owning issue once', () => {
	it('deduplicates and skips entries with no owner', () => {
		expect(stash_orphans.issues_of([PARKED, WORK, LANE, OWNERLESS])).toStrictEqual(['2346', '2370'])
	})
})

describe('stash_orphans.orphans — closed or ownerless entries only', () => {
	it('keeps the closed issues and the ownerless entry, and drops the open one', () => {
		const found = stash_orphans.orphans([PARKED, WORK, OPEN, OWNERLESS], new Set(['2346', '2370']))

		expect(found.map((entry) => entry.selector)).toStrictEqual([
			PARKED.selector,
			WORK.selector,
			OWNERLESS.selector,
		])
	})
})

describe('stash_orphans.format_report — what a person reads', () => {
	it('prints nothing for a clean stack', () => {
		expect(stash_orphans.format_report([])).toBeUndefined()
	})

	it('lists each entry with its owner and says nothing is dropped automatically', () => {
		const report = stash_orphans.format_report(
			stash_orphans.orphans([WORK, OWNERLESS], new Set(['2370'])),
		)

		expect(report).toContain(`stash@{1}  ${session_cite.issue(2370)} closed  ${WORK.subject}`)
		expect(report).toContain(`stash@{4}  owner unknown  ${OWNERLESS.subject}`)
		expect(report).toContain('none is dropped automatically')
		expect(report).toContain('pnpm josh stash:pop')
	})
})

// joshuafolkken/kit#2701: `run:tidy` drops an entry only when every issue it names is merged, so it
// needs all of them — not only the owner `issue_of` reads.
describe('stash_orphans.issues_named — every issue a subject names', () => {
	it.each([
		['On main: backlogrun: paused #2600 for prerequisite #2601', ['2600', '2601']],
		['On main: run:hold reclaimed before #2583', ['2583']],
		['On 2584-lane: 2584: uncommitted work at lane:close', ['2584']],
		['2370: uncommitted work at already-done', ['2370']],
		['On 2584-lane: backlogrun: parked #2584', ['2584']],
	])('reads %j as %j', (subject, issues) => {
		expect(stash_orphans.issues_named(subject)).toStrictEqual(issues)
	})

	it('reads a WIP entry by its branch alone, never by the commit subject', () => {
		expect(
			stash_orphans.issues_named('WIP on 2583-lane: abc123 Merge pull request #2700'),
		).toStrictEqual(['2583'])
		expect(stash_orphans.issues_named('WIP on main: abc123 Fix a thing #2700')).toStrictEqual([])
	})

	it('names nothing for a message with no number', () => {
		expect(stash_orphans.issues_named('On main: scratch work')).toStrictEqual([])
	})
})
