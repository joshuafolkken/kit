import { describe, expect, it } from 'vitest'
import { untested_sources } from './untested-sources'

// joshuafolkken/kit#3253: the regression stop that stands in for a coverage threshold. A new source
// under `scripts/` arrives with a test named after it, and the frozen list of the ones that have none
// only ever shrinks.

const ROOT = process.cwd()
const SOURCE = 'scripts/a/plan.ts'

describe('untested_sources.untested — which sources have no test named after them', () => {
	it('counts a test named after the stem', () => {
		expect(untested_sources.untested([SOURCE, 'scripts/a/plan.test.ts'])).toEqual([])
	})

	it('counts a test named after the stem and an aspect', () => {
		const files = [SOURCE, 'scripts/a/plan-budget.test.ts']

		expect(untested_sources.untested(files)).toEqual([])
	})

	it('does not count a test whose name only begins with the stem', () => {
		const files = [SOURCE, 'scripts/a/planner.test.ts']

		expect(untested_sources.untested(files)).toEqual([SOURCE])
	})

	it('does not count a test in another directory', () => {
		const files = [SOURCE, 'scripts/b/plan.test.ts']

		expect(untested_sources.untested(files)).toEqual([SOURCE])
	})

	it.each(['scripts/a/plan-fixture.ts', 'scripts/a/plan-fixtures.ts', 'scripts/a/plan.d.ts'])(
		'does not hold %s to the rule',
		(file) => {
			expect(untested_sources.untested([file])).toEqual([])
		},
	)

	it('ignores files that are not TypeScript', () => {
		expect(untested_sources.untested(['scripts/a/notes.md', 'scripts/a/hook.sh'])).toEqual([])
	})
})

describe('untested_sources.UNTESTED_SOURCES — the frozen list matches the tree', () => {
	const actual = untested_sources.untested(untested_sources.scripts_files(ROOT))
	const frozen = new Set(untested_sources.UNTESTED_SOURCES)

	it('has a test named after every source not on the list', () => {
		const unlisted = actual.filter((source) => !frozen.has(source))

		expect(unlisted, 'add a colocated <stem>.test.ts for each').toEqual([])
	})

	it('lists only sources that still have no test', () => {
		const stale = [...frozen].filter((source) => !actual.includes(source))

		expect(stale, 'remove each from UNTESTED_SOURCES').toEqual([])
	})
})
