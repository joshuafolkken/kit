import { randomBytes } from 'node:crypto'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { scoped_green } from '#scripts/gate/scoped-green'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_attest } from './review-attest'
import { review_brief_cli } from './review-brief-cli'
import type { ReviewCheckout } from './review-checkout'
import { review_tree } from './review-tree'

// joshuafolkken/kit#5113: a ship's reviewer attested its nonce and then ran `review:brief --round 2`
// itself; the new brief minted a fresh nonce, dropped the attested one's records, and the ship's
// `review:attest --check` refused a finished review as "left no attestation". A reviewer session is
// refused before any nonce is minted, so the attestation it left is still the one the check reads.
//
// Every git reader is mocked as in `review-brief-refusal.test.ts`, and the scoped-green refusal stands
// in for the rest of the brief: reaching it shows a non-reviewer session got past the reviewer check.

vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { refusal_for: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({ change_base: { resolved: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { change_base: vi.fn() } }))
vi.mock('./review-tree', () => ({ review_tree: { read_changed_tree: vi.fn() } }))

const SCOPED_REFUSAL = '⛔ scoped checks not green on this tree: run them and reissue'
const REFUSED_EXIT_CODE = 1
const ROUND_TWO = ['--round', '2']
const CHANGED_FILE = 'scripts/review/review-brief-cli.ts'
const ROOT_BYTES = 8
const LANE: ReviewCheckout = { root: '/lanes/5113', branch: '5113-lane', head: 'c4604d2c' }

const roots: Array<string> = []

function fresh_root(): string {
	const root = `/josh-review-brief-reviewer-test/${randomBytes(ROOT_BYTES).toString('hex')}`

	roots.push(root)

	return root
}

function errors(): ReadonlyArray<unknown> {
	return vi.mocked(console.error).mock.calls.map(([message]: ReadonlyArray<unknown>) => message)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(change_base.resolved).mockResolvedValue('a22b347965292713d70daff6e2b948dc7009a265')
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_FILE])
	vi.mocked(review_tree.read_changed_tree).mockResolvedValue({ [CHANGED_FILE]: 'digest' })
	vi.mocked(scoped_green.refusal_for).mockReturnValue(SCOPED_REFUSAL)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	for (const root of roots.splice(0)) review_attest.clear(root)
})

describe('josh review:brief in a reviewer session', () => {
	it('refuses by name without minting a nonce', async () => {
		vi.stubEnv(agent_session_role.KEY, agent_role_profile.REVIEWER)
		const record = vi.spyOn(review_attest, 'record_target')

		await expect(review_brief_cli.run(ROUND_TWO)).resolves.toBe(REFUSED_EXIT_CODE)
		expect(record).not.toHaveBeenCalled()
		expect(errors()).toEqual([expect.stringContaining('reviewer session')])
	})

	it('leaves the attestation the reviewer already left for the check', async () => {
		const root = fresh_root()

		review_attest.attest(review_attest.record_target(LANE, root), LANE)
		vi.stubEnv(agent_session_role.KEY, agent_role_profile.REVIEWER)
		await review_brief_cli.run(ROUND_TWO)

		expect(review_attest.check(Date.now(), root).status).toBe('ok')
	})
})

describe('josh review:brief outside a reviewer session', () => {
	it('goes on past the reviewer check to the brief', async () => {
		vi.stubEnv(agent_session_role.KEY, '')

		await expect(review_brief_cli.run(ROUND_TWO)).resolves.toBe(REFUSED_EXIT_CODE)
		expect(errors()).toEqual([SCOPED_REFUSAL])
	})
})
