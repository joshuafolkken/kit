import { git_command } from '#scripts/git/git-command'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_workflow_check } from './release-workflow-check'

const TIP = 'origin/main'
const GITHUB_RELEASE = '.github/workflows/github-release.yml'
const PUBLISH = '.github/workflows/publish.yml'
const RELEASE_STEP_BODY =
	'jobs:\n  create-release:\n    steps:\n      - run: pnpm josh release:github\n'
const NPM_ONLY_BODY = 'jobs:\n  publish:\n    steps:\n      - run: npm publish\n'

function hold(listing: string, body = RELEASE_STEP_BODY): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_command, 'tree_names_at').mockResolvedValue(listing)
	vi.spyOn(git_command, 'show_file').mockResolvedValue(body)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_workflow_check.missing_workflow_message', () => {
	it('names the missing workflow and the sync that adds it', () => {
		const text = release_workflow_check.missing_workflow_message(TIP)

		expect(text).toContain('github-release.yml')
		expect(text).toContain('publish.yml')
		expect(text).toContain('v1.1093.0')
		expect(text).toContain('pnpm josh sync')
		expect(text).toContain(TIP)
	})
})

describe('release_workflow_check.assert_release_workflow', () => {
	it('reads both workflows from the tip', async () => {
		hold(GITHUB_RELEASE)

		await release_workflow_check.assert_release_workflow(TIP)

		expect(git_command.tree_names_at).toHaveBeenCalledWith(TIP, [GITHUB_RELEASE, PUBLISH])
		expect(git_command.show_file).toHaveBeenCalledWith(`${TIP}:${GITHUB_RELEASE}`)
	})

	it.each([GITHUB_RELEASE, PUBLISH])(
		'passes and reports %s when the tip holds it',
		async (name) => {
			hold(name)

			await expect(release_workflow_check.assert_release_workflow(TIP)).resolves.toBeUndefined()
			expect(console.info).toHaveBeenCalledWith(
				release_workflow_check.found_workflow_message([name]),
			)
		},
	)

	it('refuses when the tip holds neither', async () => {
		hold('')

		await expect(release_workflow_check.assert_release_workflow(TIP)).rejects.toThrow(
			release_workflow_check.missing_workflow_message(TIP),
		)
	})

	// A repository's own npm `publish.yml` shares the name but creates no GitHub Release.
	it('refuses a publish.yml that does not run josh release:github', async () => {
		hold(PUBLISH, NPM_ONLY_BODY)

		await expect(release_workflow_check.assert_release_workflow(TIP)).rejects.toThrow(
			release_workflow_check.missing_workflow_message(TIP),
		)
	})
})
