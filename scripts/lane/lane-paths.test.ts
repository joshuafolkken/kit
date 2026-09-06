import path from 'node:path'
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

	it('namespaces the branch so a lane branch is never mistaken for an issue branch', () => {
		expect(lane_paths.lane_branch(ISSUE)).toBe('lane/1490')
	})
})
