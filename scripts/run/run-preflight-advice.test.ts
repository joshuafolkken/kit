import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { run_preflight, type ChildState, type PrState, type TreeState } from './run-preflight'

const MAIN_SYNC = 'pnpm josh ms'
const ISSUE = '926'
const CLEAN_TREE: TreeState = { branch: 'main', default_branch: 'main', is_dirty: false }
const NO_WORK: ChildState = { branch_name: undefined, pr_state: 'none' }

function child(pr_state: PrState, branch_name?: string): ChildState {
	return { branch_name, pr_state }
}

describe('the advice names what the rule requires', () => {
	it('stashes with -u and records the stash instead of popping it', () => {
		const { advice } = run_preflight.decide({ ...CLEAN_TREE, is_dirty: true }, NO_WORK, ISSUE)

		expect(advice).toContain(`pnpm josh stash:push "${run_preflight.STASH_LABEL_PREFIX}${ISSUE}"`)
		expect(advice).toContain(`Record the stash on ${session_cite.issue(ISSUE)}`)
		expect(advice).not.toContain('git stash pop')
	})

	// A clean checkout parked on a feature branch also answers `reclaim`, and telling the caller to
	// record a stash `git stash push` never created posts an Issue comment naming nothing.
	it('prescribes no stash over a clean tree that is merely on the wrong branch', () => {
		const tree: TreeState = { branch: '927-x', default_branch: 'main', is_dirty: false }
		const { advice } = run_preflight.decide(tree, NO_WORK, ISSUE)

		expect(advice).not.toContain('git stash')
		expect(advice).not.toContain('Record the stash')
		expect(advice).toContain(MAIN_SYNC)
	})

	// joshuafolkken/kit#3463: a raw `git pull` that changes the lock skips the reinstall `josh ms` carries.
	it('syncs through josh ms rather than a raw git pull', () => {
		const { advice } = run_preflight.decide({ ...CLEAN_TREE, branch: 'work' }, NO_WORK, ISSUE)

		expect(advice).toContain(MAIN_SYNC)
		expect(advice).not.toContain('git pull')
	})

	it('requires the whole verification gate when a branch is reused', () => {
		expect(run_preflight.decide(CLEAN_TREE, child('open', '926-x'), ISSUE).advice).toContain(
			run_preflight.RESUME_ADVICE,
		)
		expect(run_preflight.RESUME_ADVICE).toContain('from the start')
	})

	it('names what was found in the reason', () => {
		expect(run_preflight.decide(CLEAN_TREE, child('open', '926-x'), ISSUE).reason).toContain(
			'926-x',
		)
	})
})

// joshuafolkken/kit#7653: a run resumed in a lane without asking again held nothing and carried no
// `in-progress`, so neither the board nor `run:progress` showed it.
describe('a branch resumed in a lane', () => {
	it('asks again in the lane the branch is checked out in, as after a switch', () => {
		const lane_directory = '/work/.kit-lanes/926'
		const in_lane = { ...child('none', '926-lane'), lane_directory }
		const { advice } = run_preflight.decide(CLEAN_TREE, in_lane, ISSUE)

		expect(advice).toContain(`cd ${lane_directory}`)
		expect(advice).toContain('Then ask this command again: it takes the hold there.')
	})
})
