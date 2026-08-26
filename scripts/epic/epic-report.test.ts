import { describe, expect, it } from 'vitest'
import type { Classification } from './epic-classify'
import type { EpicChild } from './epic-graph'
import { epic_report } from './epic-report'

const KIT = 'joshuafolkken/kit'
const APP_KIT = 'joshuafolkken/app-kit'
const KIT_PATH = '/Users/example/Development/kit'
const CYCLE_MESSAGE = 'Circular dependency: #1, #2'

function child(number: number, repo = KIT): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [] }
}

function classification(partial: Partial<Classification>): Classification {
	return { runnable: [], time: [], human: [], ...partial }
}

describe('epic_report.bundle_by_repo', () => {
	// A single-candidate answer would close off cross-repository parallelism in the design itself,
	// making the command slower than the person opening several editors it replaces.
	it('returns every runnable child, not one', () => {
		const bundles = epic_report.bundle_by_repo([child(1), child(2), child(3, APP_KIT)])
		const counted = bundles.flatMap((bundle) => bundle.children).length

		expect(counted).toBe(3)
	})

	it('bundles the children by repository', () => {
		const bundles = epic_report.bundle_by_repo([child(1), child(3, APP_KIT), child(2)])

		expect(bundles.map((bundle) => bundle.repo)).toEqual([APP_KIT, KIT])
	})

	it('orders repositories and children so a run is reproducible', () => {
		const bundles = epic_report.bundle_by_repo([child(2), child(1)])

		expect(bundles[0]?.children.map((entry) => entry.number)).toEqual([1, 2])
	})
})

// joshuafolkken/kit#864: a runner needs to know which checkout to work in. The path comes from
// joshuafolkken/kit#869's map; a repository absent from it is reported without one rather than
// cloned.
describe('epic_report.bundle_by_repo — the dispatch target', () => {
	it('carries the local checkout for a repository the map knows', () => {
		const paths = new Map([[KIT, KIT_PATH]])
		const [bundle] = epic_report.bundle_by_repo([child(1)], paths)

		expect(bundle?.path).toBe(KIT_PATH)
	})

	it('leaves the path unset for a repository the map does not know', () => {
		const [bundle] = epic_report.bundle_by_repo([child(1)])

		expect(bundle?.path).toBeUndefined()
	})

	it('says so rather than omitting the repository when there is no checkout', () => {
		const [bundle] = epic_report.bundle_by_repo([child(1)])

		expect(bundle === undefined ? '' : epic_report.format_bundle_heading(bundle)).toContain(
			'no local checkout',
		)
	})
})

describe('epic_report.decide_verdict', () => {
	it('runs when something is runnable', () => {
		const result = classification({ runnable: [child(1)], time: [child(2)] })

		expect(epic_report.decide_verdict(result, 0)).toBe('run')
	})

	// The failure the categories exist to prevent: stopping while something is still resolving on
	// its own abandons an epic that was going to finish.
	it('waits when nothing is runnable but something resolves on its own', () => {
		const waiting = classification({ time: [child(1)] })

		expect(epic_report.decide_verdict(waiting, 0)).toBe('wait')
	})

	it('waits even when a person is also needed elsewhere', () => {
		const result = classification({ time: [child(1)], human: [child(2)] })

		expect(epic_report.decide_verdict(result, 0)).toBe('wait')
	})

	it('stops when only people can move anything', () => {
		const parked = classification({ human: [child(1)] })

		expect(epic_report.decide_verdict(parked, 0)).toBe('stop')
	})

	it('reports completion when no open child is left', () => {
		expect(epic_report.decide_verdict(classification({}), 0)).toBe('complete')
	})

	it('reports an unusable graph before anything else', () => {
		const runnable = classification({ runnable: [child(1)] })

		expect(epic_report.decide_verdict(runnable, 1)).toBe('error')
	})
})

describe('epic_report.pick_for_repo', () => {
	it('takes the lowest-numbered candidate for the repository', () => {
		const result = epic_report.build_result(classification({ runnable: [child(2), child(1)] }), [])

		expect(epic_report.pick_for_repo(result, KIT)?.number).toBe(1)
	})

	it('returns nothing for a repository with no candidate', () => {
		const result = epic_report.build_result(classification({ runnable: [child(1)] }), [])

		expect(epic_report.pick_for_repo(result, APP_KIT)).toBeUndefined()
	})
})

describe('epic_report.format_result', () => {
	it('names each repository and its candidates', () => {
		const result = epic_report.build_result(
			classification({ runnable: [child(1), child(3, APP_KIT)] }),
			[],
		)
		const text = epic_report.format_result(result)

		expect(text).toContain(KIT)
		expect(text).toContain(APP_KIT)
	})

	it('accounts for the children nobody can run yet', () => {
		const result = epic_report.build_result(
			classification({ time: [child(2)], human: [child(3)] }),
			[],
		)
		const text = epic_report.format_result(result)

		expect(text).toContain('#2')
		expect(text).toContain('#3')
	})

	it('offers no candidate at all when the graph is unusable', () => {
		const result = epic_report.build_result(classification({ runnable: [child(1)] }), [
			{ kind: 'cycle', message: CYCLE_MESSAGE },
		])

		expect(result.candidates).toEqual([])
	})

	it('prints the anomaly instead of a candidate list when the graph is unusable', () => {
		const result = epic_report.build_result(classification({ runnable: [child(1)] }), [
			{ kind: 'cycle', message: CYCLE_MESSAGE },
		])

		expect(epic_report.format_result(result)).toContain(CYCLE_MESSAGE)
	})
})
