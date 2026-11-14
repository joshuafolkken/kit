import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { lane_early_push_count } from '#scripts/lane/lane-early-push-count'
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

const LEDGER_BODY = fixture.ledger_body(lane_early_push_count.MULTI_SLOT_EARLY_PUSH)
const MULTI_SLOT_PUSH = {
	kind: 'early-push',
	at: '2026-11-14T00:00:00.000Z',
	source: 'review',
	result: 'pushed',
	slots: 2,
} as const

it('primes the ledger sample a declaration names', async () => {
	const read = vi.fn().mockResolvedValue(fixture.comment([]))

	await issue_observation_prime.prime([LEDGER_BODY], read, async () => [])
	expect(issue_observation_gate.wait_of(LEDGER_BODY)?.reason).toContain('required')
	await issue_observation_prime.prime([LEDGER_BODY], read, async () => [MULTI_SLOT_PUSH])
	expect(issue_observation_gate.wait_of(LEDGER_BODY)).toBeUndefined()
})

it('reads no ledger without a ledger condition, and counts nothing on a failed read', async () => {
	const read = vi.fn().mockResolvedValue(fixture.comment([]))
	const ledger = vi.fn().mockRejectedValue(new Error('unreadable'))

	await issue_observation_prime.prime([fixture.BODY], read, ledger)
	expect(ledger).not.toHaveBeenCalled()
	await issue_observation_prime.prime([LEDGER_BODY], read, ledger)
	expect(issue_observation_gate.wait_of(LEDGER_BODY)?.reason).toContain('required')
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
