import { git_gh_command } from '#scripts/git/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_bundle_referenced } from './epic-bundle-referenced'

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_get_plan_fields_classified: vi.fn() },
}))

const mocked_read = vi.mocked(git_gh_command.issue_get_plan_fields_classified)

const MISSING_NUMBER = 99_999
const PRESENT_NUMBER = 891

function plan_json(number: number): string {
	return JSON.stringify({
		number,
		title: '',
		body: '',
		state: 'CLOSED',
		url: `https://github.com/joshuafolkken/kit/issues/${String(number)}`,
		labels: [],
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#957: this is the seam the fix lives on. `collect_referenced` is exercised with
// hand-built results and the classification is exercised at the gh layer, so without a test here a
// read that mapped a missing number back onto `unreadable` would reintroduce the defect with the
// suite fully green.
describe('epic_bundle_referenced.fetch_referenced', () => {
	it('carries a missing number through as missing rather than as unreadable', async () => {
		mocked_read.mockResolvedValueOnce({ kind: 'missing' })

		await expect(epic_bundle_referenced.fetch_referenced([MISSING_NUMBER])).resolves.toEqual([
			{ number: MISSING_NUMBER, result: 'missing' },
		])
	})

	it('carries a failed read through as unreadable', async () => {
		mocked_read.mockResolvedValueOnce({ kind: 'unreadable' })

		await expect(epic_bundle_referenced.fetch_referenced([PRESENT_NUMBER])).resolves.toEqual([
			{ number: PRESENT_NUMBER, result: 'unreadable' },
		])
	})

	it('carries a successful read through as the issue itself', async () => {
		mocked_read.mockResolvedValueOnce({ kind: 'read', json: plan_json(PRESENT_NUMBER) })

		const [read] = await epic_bundle_referenced.fetch_referenced([PRESENT_NUMBER])

		expect(read?.result).toMatchObject({ number: PRESENT_NUMBER, state: 'CLOSED' })
	})

	// A read that answered but came back shaped wrong is a gap, not an absent issue: the number
	// resolved to something, so what is missing is in the answer rather than in the number.
	it('treats a read that will not parse as unreadable, never as missing', async () => {
		mocked_read.mockResolvedValueOnce({ kind: 'read', json: 'not json at all' })

		await expect(epic_bundle_referenced.fetch_referenced([PRESENT_NUMBER])).resolves.toEqual([
			{ number: PRESENT_NUMBER, result: 'unreadable' },
		])
	})
})
