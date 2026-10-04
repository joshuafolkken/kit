import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { github_release_cli } from './github-release-cli'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('github_release_cli.local_tags', () => {
	it('lists the local tags one per line', () => {
		const read = vi.spyOn(git_spawn_sync, 'read').mockReturnValue('v1.0.0\nv1.1.0')

		expect(github_release_cli.local_tags()).toStrictEqual(['v1.0.0', 'v1.1.0'])
		expect(read).toHaveBeenCalledWith(['tag', '--list'])
	})

	// A release published from an empty tag list would pick its previous tag from nothing.
	it('throws rather than reading a failed git as no tags', () => {
		vi.spyOn(git_spawn_sync, 'read').mockReturnValue(undefined)

		expect(() => github_release_cli.local_tags()).toThrow('git tag --list failed')
	})
})
