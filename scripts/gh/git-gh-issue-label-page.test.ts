import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_issue } from './git-gh-issue'
import { TRANSPORT_ENV_VAR } from './git-gh-transport'

// joshuafolkken/kit#7226: `backlog:drive` asks whether the `auto-ok` listing changed by reading the
// page `backlog:next` reads over REST, so on that transport both share one disk ETag.

const ETAG = 'W/"listing"'
const EMPTY_PAGE = '[]'

const CHANGED: ConditionalRead = { kind: 'changed', etag: ETAG, body: EMPTY_PAGE }
const UNCHANGED: ConditionalRead = { kind: 'unchanged' }

function answer_with(...answers: Array<ConditionalRead>): void {
	const mocked = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) mocked.mockResolvedValueOnce(answer)
}

function sent(): Array<{ path: string; etag: string | undefined }> {
	const { calls } = vi.mocked(git_gh_conditional.read_conditional).mock

	return calls.map(([path, etag]) => ({ path, etag }))
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	shared_cache_fixture.keep_in_memory()
})

describe('git_gh_issue.issue_list_label_first_page', () => {
	it("reads the first page of backlog:next's opted-in listing, sending its kept ETag", async () => {
		answer_with(CHANGED, UNCHANGED)

		await auto_ok_cli.fetch_opted_in()
		await git_gh_issue.issue_list_label_first_page(AUTO_OK_LABEL)

		const [listing, probe] = sent()

		expect(probe).toStrictEqual({ path: listing?.path, etag: ETAG })
	})

	it('answers the kept page as unchanged on a 304', async () => {
		answer_with(CHANGED, UNCHANGED)

		await auto_ok_cli.fetch_opted_in()

		expect(await git_gh_issue.issue_list_label_first_page(AUTO_OK_LABEL)).toStrictEqual({
			body: EMPTY_PAGE,
			is_unchanged: true,
		})
	})
})
