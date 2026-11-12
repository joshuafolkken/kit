import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { cli_body_repository } from '#scripts/josh/cli-body-repository-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { issue_file_cli } from './issue-file-cli'

// joshuafolkken/kit#6056: `issue:file --body-file` reads through `cli_body`, so a body left in the
// work tree is refused with the reader's own sentence before anything is sent.

const FAILURE_EXIT_CODE = 1
const make_directory = temporary_directory('suite')
const repository = cli_body_repository.create(make_directory('issue-file-cli-body-location-'))

describe('issue_file_cli.run — where the body file sits', () => {
	it('refuses a body in the work tree that git does not ignore, sending nothing', async () => {
		const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const body_path = repository.write(cli_body_repository.UNIGNORED_DIRECTORY, 'Title\n')

		expect(await issue_file_cli.run(['A title', '--body-file', body_path])).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('not git-ignored'))
	})
})
