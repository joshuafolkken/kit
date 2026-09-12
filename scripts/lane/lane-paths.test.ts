import path from 'node:path'
import { git_branch } from '#scripts/git/git-branch'
import { issue_logic } from '#scripts/issue/issue-logic'
import { describe, expect, it } from 'vitest'
import { lane_paths } from './lane-paths'

// joshuafolkken/kit#1490: a lane is a second full checkout, so where it is put decides whether every
// path-walking tool in the project sees a duplicate of itself. These pin that it lands outside the
// repository, and that the override is the only thing that can move it.

const REPOSITORY_ROOT = '/Users/someone/Development/kit'
const ISSUE = '1490'

describe('where a lane lives', () => {
	it('puts lanes in a hidden sibling of the repository, never inside it', () => {
		const root = lane_paths.lane_root(REPOSITORY_ROOT, {})

		expect(root).toBe('/Users/someone/Development/.kit-lanes')
		expect(root.startsWith(REPOSITORY_ROOT)).toBe(false)
	})

	it('names the directory after the repository, so two projects never share one', () => {
		expect(lane_paths.default_lane_root('/w/app-kit')).toBe('/w/.app-kit-lanes')
		expect(lane_paths.default_lane_root('/w/game-kit')).toBe('/w/.game-kit-lanes')
	})

	it('takes an explicit override, resolved to an absolute path', () => {
		const environment = { [lane_paths.LANE_ROOT_KEY]: 'lanes' }

		expect(lane_paths.lane_root(REPOSITORY_ROOT, environment)).toBe(path.resolve('lanes'))
	})

	it('reads a blank override as unset rather than as the filesystem root', () => {
		const environment = { [lane_paths.LANE_ROOT_KEY]: ' '.repeat(3) }

		expect(lane_paths.lane_root(REPOSITORY_ROOT, environment)).toBe(
			lane_paths.default_lane_root(REPOSITORY_ROOT),
		)
	})
})

describe('what a lane is called', () => {
	it('names the work tree after the issue it was opened for', () => {
		expect(lane_paths.lane_directory('/w/.kit-lanes', ISSUE)).toBe('/w/.kit-lanes/1490')
	})

	it('leads the branch with the issue number, which is what a commit from a lane needs', () => {
		expect(lane_paths.lane_branch(ISSUE)).toBe('1490-lane')
	})

	// joshuafolkken/kit#1497: `lane/<N>` was rejected by this very function, so `pnpm josh git` exited
	// 1 before committing anything and the whole lane path was unusable. Asserting against the real
	// matcher rather than a copy of its pattern is the point — a copy is what let the mismatch ship.
	it('produces a branch pnpm josh git will commit from', () => {
		const target = `${ISSUE}-name-a-lane-branch`

		expect(git_branch.has_same_issue_prefix(lane_paths.lane_branch(ISSUE), target)).toBe(true)
	})

	// The name is inside the namespace `pnpm josh git` generates, and there is no spelling that both
	// leads with `<N>-` and stays out of it: an issue titled "Lane" slugs to exactly this. Pinned so
	// the next reader knows the collision is real and is answered by `lane_registry.parse_block`
	// requiring the work tree to sit at `<lane root>/<N>`, not by the branch name being unique.
	it('is a name pnpm josh git could also generate, which is why the directory is checked too', () => {
		expect(issue_logic.suggest_branch_name(Number(ISSUE), 'Lane')).toBe(
			lane_paths.lane_branch(ISSUE),
		)
	})
})

// joshuafolkken/kit#1864: the pre-gate guard has to know whether the checkout it runs in is a lane,
// and it has to know synchronously — so the question is answered off the path rather than by
// `lane_registry`, which parses `git worktree list` asynchronously. **The direction that matters is
// the negative one**: a false positive here refuses the gate of an ordinary run.
describe('lane_issue_of', () => {
	const DEFAULT_ROOT = lane_paths.lane_root(REPOSITORY_ROOT, {})
	const OVERRIDE_ROOT = '/Volumes/work/lanes'

	it('reads the issue number back out of the directory it built', () => {
		const directory = lane_paths.lane_directory(DEFAULT_ROOT, ISSUE)

		expect(lane_paths.lane_issue_of(directory, {})).toBe(ISSUE)
	})

	it('reads it back under an overridden root too', () => {
		const environment = { [lane_paths.LANE_ROOT_KEY]: OVERRIDE_ROOT }
		const directory = lane_paths.lane_directory(lane_paths.lane_root('', environment), ISSUE)

		expect(lane_paths.lane_issue_of(directory, environment)).toBe(ISSUE)
	})

	// **The override is exact, so a lane root elsewhere is not this project's.** Read loosely, a
	// machine with the override set would have every `.<name>-lanes` directory answer as a lane.
	it('says nothing about the default root once an override names somewhere else', () => {
		const directory = lane_paths.lane_directory(DEFAULT_ROOT, ISSUE)
		const environment = { [lane_paths.LANE_ROOT_KEY]: OVERRIDE_ROOT }

		expect(lane_paths.lane_issue_of(directory, environment)).toBeUndefined()
	})

	it.each([
		// The repository itself, which is where an ordinary run's gate is issued.
		[REPOSITORY_ROOT],
		// The lane root, which holds lanes but is not one.
		[DEFAULT_ROOT],
		// A sibling directory whose name is not an issue number.
		[path.join(DEFAULT_ROOT, 'main')],
		// A numbered directory that is not under a lane root at all.
		[path.join(REPOSITORY_ROOT, ISSUE)],
	])('says nothing about %j', (directory) => {
		expect(lane_paths.lane_issue_of(directory, {})).toBeUndefined()
	})
})
