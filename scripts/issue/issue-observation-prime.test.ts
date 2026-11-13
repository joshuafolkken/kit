import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, expect, it, vi } from 'vitest'
import { issue_observation_fixture as fixture } from './issue-observation-fixture'
import { issue_observation_gate } from './issue-observation-gate'
import { issue_observation_prime } from './issue-observation-prime'
import { issue_sample_prime } from './issue-sample-prime'

afterEach(() => {
	vi.restoreAllMocks()
	issue_observation_gate.reset()
})

function serve_comment(): void {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(
		JSON.stringify({
			body: fixture.comment(fixture.KEYS),
			html_url: fixture.URL,
			author_association: 'OWNER',
			user: { login: 'owner' },
		}),
	)
}

it('primes observation facts through the existing shared primer without a merge condition', async () => {
	serve_comment()
	await issue_sample_prime.prime([fixture.BODY])
	expect(issue_observation_gate.wait_of(fixture.BODY)).toBeUndefined()
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({
		path: 'repos/joshuafolkken/kit/issues/comments/123',
	})
})

it('reads each source once per prime and rechecks previously satisfied evidence', async () => {
	const read = vi.fn().mockResolvedValue(fixture.comment(fixture.KEYS))

	await issue_observation_prime.prime([fixture.BODY, fixture.BODY], read)
	expect(read).toHaveBeenCalledOnce()
	read.mockRejectedValue(new Error('offline'))
	await issue_observation_prime.prime([fixture.BODY], read)
	expect(issue_observation_gate.wait_of(fixture.BODY)?.reason).toContain('unread')
})

it('withholds an unreadable or untrusted evidence comment', async () => {
	serve_comment()
	vi.spyOn(gh_author_association, 'is_trusted').mockResolvedValue(false)
	await issue_observation_prime.prime([fixture.BODY])
	expect(issue_observation_gate.wait_of(fixture.BODY)?.reason).toContain('unread')
	vi.mocked(git_gh_exec.exec_gh_api).mockResolvedValue('invalid json')
	await issue_observation_prime.prime([fixture.BODY])
	expect(issue_observation_gate.wait_of(fixture.BODY)?.reason).toContain('unread')
})
