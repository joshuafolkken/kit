import { describe, expect, it } from 'vitest'
import { propagate_run } from './propagate-run'
import { propagate_select } from './propagate-select'
import type { PropagateTarget, TargetState } from './propagate-targets'

const APP_KIT = 'joshuafolkken/app-kit'
const GAME_KIT = 'joshuafolkken/game-kit'
const UNRELATED = 'joshuafolkken/unrelated'
const REFUSAL = 'Refusing to propagate'
const UNKNOWN_NAME = 'no-such-repo'
const NOT_SELECTED_REASON = 'not the repository --target named'

function candidate(repo: string, state: TargetState = 'ready'): PropagateTarget {
	return { repo, path: `/Users/example/Development/${repo}`, state }
}

const CANDIDATES: ReadonlyArray<PropagateTarget> = [
	candidate(APP_KIT),
	candidate(GAME_KIT),
	candidate(UNRELATED, 'not_downstream'),
]

function states_after(name: string): Array<TargetState> {
	return propagate_select.select_target(CANDIDATES, name).targets.map((target) => target.state)
}

describe('propagate_select.select_target — narrowing the run', () => {
	it('leaves every candidate untouched when no target was named', () => {
		const selection = propagate_select.select_target(CANDIDATES, undefined)

		expect(selection.refusal).toBeUndefined()
		expect(selection.targets).toEqual(CANDIDATES)
	})

	// A repository that never depended on the package keeps saying so, rather than "not the one named".
	it('keeps the named consumer ready and marks the other consumers not selected', () => {
		expect(states_after('app-kit')).toEqual(['ready', 'not_selected', 'not_downstream'])
	})

	it('accepts the full owner/repo form as well as the bare repository name', () => {
		expect(states_after(GAME_KIT)).toEqual(['not_selected', 'ready', 'not_downstream'])
	})

	it('accepts a named consumer that already carries the release, which is then a skip', () => {
		const targets = [candidate(APP_KIT, 'up_to_date'), candidate(GAME_KIT)]

		expect(propagate_select.select_target(targets, 'app-kit').refusal).toBeUndefined()
	})

	// The report has to say why the other consumers were left alone, and none of them may be written.
	it('reports the candidates it left out as skips that run no step', () => {
		const { targets } = propagate_select.select_target(CANDIDATES, 'app-kit')
		const results = propagate_run.run_targets(targets, (_target, step) => ({ step, is_ok: true }))
		const [, game_kit] = results

		expect(game_kit?.outcome).toBe('skipped')
		expect(game_kit?.reason).toBe(NOT_SELECTED_REASON)
		expect(game_kit?.steps).toEqual([])
	})
})

describe('propagate_select.select_target — names that cannot be targeted', () => {
	it('refuses a name that matches no candidate, and selects nothing', () => {
		const selection = propagate_select.select_target(CANDIDATES, UNKNOWN_NAME)

		expect(selection.refusal).toContain(REFUSAL)
		expect(selection.refusal).toContain(UNKNOWN_NAME)
		expect(selection.targets).toEqual([])
	})

	it('refuses a candidate that does not depend on the package', () => {
		const selection = propagate_select.select_target(CANDIDATES, 'unrelated')

		expect(selection.refusal).toContain('does not depend on this package')
		expect(selection.targets).toEqual([])
	})

	it('refuses a candidate whose checkout is missing', () => {
		const targets = [candidate(APP_KIT, 'missing_checkout')]

		expect(propagate_select.select_target(targets, 'app-kit').refusal).toContain(REFUSAL)
	})

	it('refuses a bare name that two owners share, rather than picking one', () => {
		const targets = [candidate(APP_KIT), candidate('someone-else/app-kit')]

		expect(propagate_select.select_target(targets, 'app-kit').refusal).toContain('owner/repo')
	})
})

describe('propagate_select.matches_name', () => {
	it('does not match a name that is only a suffix of the repository', () => {
		expect(propagate_select.matches_name(APP_KIT, 'kit')).toBe(false)
	})
})
