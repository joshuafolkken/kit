import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { github_release } from './github-release'
import { github_release_cli } from './github-release-cli'
import { github_release_environment } from './github-release-environment'

const NODE = 'node'
const SCRIPT_NAME = 'github-release-cli.ts'
const RELEASE_INPUT = github_release_environment.read_release_input({
	GH_TOKEN: 'token',
	RELEASE_TAG: 'v1.0.0',
	GITHUB_REPOSITORY: 'owner/name',
})

afterEach(() => {
	vi.restoreAllMocks()
})

function arrange_publish(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_spawn_sync, 'read').mockReturnValue('v1.0.0')
	vi.spyOn(github_release_environment, 'read_release_input').mockReturnValue(RELEASE_INPUT)
	vi.spyOn(github_release, 'publish').mockResolvedValue('published')
}

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

describe('github_release_cli.run_argv', () => {
	// A `--help` the command did not read would create a real GitHub Release (joshuafolkken/kit#3385).
	it.each(['--help', '-h'])('prints the usage and publishes nothing on %s', async (flag) => {
		arrange_publish()

		const code = await github_release_cli.run_argv([NODE, SCRIPT_NAME, flag])

		expect(code).toBe(0)
		expect(console.info).toHaveBeenCalledWith('Usage: josh release:github')
		expect(github_release_environment.read_release_input).not.toHaveBeenCalled()
		expect(github_release.publish).not.toHaveBeenCalled()
	})

	it('refuses an unknown argument before anything is published', async () => {
		arrange_publish()

		const code = await github_release_cli.run_argv([NODE, SCRIPT_NAME, '--draft'])

		expect(code).not.toBe(0)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--draft'))
		expect(github_release.publish).not.toHaveBeenCalled()
	})

	it('publishes with no arguments', async () => {
		arrange_publish()

		const code = await github_release_cli.run_argv([NODE, SCRIPT_NAME])

		expect(code).toBe(0)
		expect(github_release.publish).toHaveBeenCalledTimes(1)
		expect(console.info).toHaveBeenCalledWith('published')
	})
})
