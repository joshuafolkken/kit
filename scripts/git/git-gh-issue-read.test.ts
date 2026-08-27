import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read as git_gh_issue, NOT_FOUND_STATUS } from './git-gh-issue-read'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_command: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)
const mocked_status = vi.mocked(git_gh_exec.exec_gh_api_status)

const PLAN_JSON = '{"number":891,"state":"CLOSED"}'
const OTHER_REPO = 'joshuafolkken/app-kit'
const ISSUE_TITLE = 'Fix login bug'
const RATE_LIMITED_STATUS = 429

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#957: a read that produced nothing was reported as one the command had failed to
// make, whatever the reason. A number that resolves to nothing is not a gap — reported as one, a
// single typo in an issue body stops an unattended run.
describe('issue_view_json_classified', () => {
	it('returns the json when the read succeeded', async () => {
		mocked_command.mockResolvedValueOnce(PLAN_JSON)

		await expect(git_gh_issue.issue_view_json_classified('891', 'state')).resolves.toEqual({
			kind: 'read',
			json: PLAN_JSON,
		})
	})

	// The success path must never spend the extra request: it is the path every ordinary read takes.
	it('spends no status request when the read succeeded', async () => {
		mocked_command.mockResolvedValueOnce(PLAN_JSON)

		await git_gh_issue.issue_view_json_classified('891', 'state')

		expect(mocked_status).not.toHaveBeenCalled()
	})
})

describe('issue_view_json_classified — telling the two failures apart', () => {
	it('reports a number that resolves to nothing as missing', async () => {
		mocked_command.mockRejectedValueOnce(new Error('Could not resolve to an issue'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue.issue_view_json_classified('99999', 'state')).resolves.toEqual({
			kind: 'missing',
		})
	})

	// The distinction is the point: a rate limit is a gap, because the issue may well exist.
	it('reports a rate-limited read as unreadable', async () => {
		mocked_command.mockRejectedValueOnce(new Error('API rate limit exceeded'))
		mocked_status.mockResolvedValueOnce(RATE_LIMITED_STATUS)

		await expect(git_gh_issue.issue_view_json_classified('891', 'state')).resolves.toEqual({
			kind: 'unreadable',
		})
	})

	// No status at all — gh missing, a dropped connection — is a failed read, not an absent issue.
	it('reports a read with no status at all as unreadable', async () => {
		mocked_command.mockRejectedValueOnce(new Error('connection reset'))
		mocked_status.mockResolvedValueOnce(undefined)

		await expect(git_gh_issue.issue_view_json_classified('891', 'state')).resolves.toEqual({
			kind: 'unreadable',
		})
	})

	// The classification is a status code, never `gh`'s wording: a message is prose that can be
	// reworded between releases, and a string match on it would silently start answering `unreadable`
	// for every missing number.
	it('classifies by status code rather than by the error text', async () => {
		mocked_command.mockRejectedValueOnce(new Error('some entirely different wording'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue.issue_view_json_classified('99999', 'state')).resolves.toEqual({
			kind: 'missing',
		})
	})
})

describe('issue_view_json_classified — which repository it probes', () => {
	it('probes the current repository when no repo is given', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await git_gh_issue.issue_view_json_classified('99999', 'state')

		expect(mocked_status).toHaveBeenCalledWith('repos/{owner}/{repo}/issues/99999')
	})

	// A qualified reference reads another repository's issue, so the probe has to follow it there —
	// otherwise the status would describe this repository's issue of that number, a different one.
	it('probes the named repository when one is given', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await git_gh_issue.issue_view_json_classified('99999', 'state', OTHER_REPO)

		expect(mocked_status).toHaveBeenCalledWith('repos/joshuafolkken/app-kit/issues/99999')
	})
})

// The classification is opt-in. A caller that does not need it must keep costing one request even
// when the read fails, or a rate-limited batch of two hundred reads doubles into four hundred.
describe('issue_view_json — unchanged by the classification', () => {
	it('still answers undefined when the read failed', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_view_json('891', 'state')).resolves.toBeUndefined()
	})

	it('spends no status request when the read failed', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))

		await git_gh_issue.issue_view_json('891', 'state')

		expect(mocked_status).not.toHaveBeenCalled()
	})

	it('leaves issue_get_state_and_relations answering undefined on a failed read', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_get_state_and_relations('891')).resolves.toBeUndefined()
		expect(mocked_status).not.toHaveBeenCalled()
	})

	it('leaves issue_get_plan_fields answering undefined on a failed read', async () => {
		mocked_command.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_get_plan_fields('891')).resolves.toBeUndefined()
		expect(mocked_status).not.toHaveBeenCalled()
	})
})

describe('issue_get_plan_fields_classified', () => {
	it('asks for the same fields the unclassified read does', async () => {
		mocked_command.mockResolvedValueOnce(PLAN_JSON)
		await git_gh_issue.issue_get_plan_fields_classified('891')
		const [classified] = mocked_command.mock.calls

		mocked_command.mockResolvedValueOnce(PLAN_JSON)
		await git_gh_issue.issue_get_plan_fields('891')

		expect(classified).toEqual(mocked_command.mock.calls[1])
	})
})

// A notification about another repository's issue reads that repository's title. Unqualified, `gh`
// answers with this repository's issue of the same number (joshuafolkken/kit#903).
describe('issue_get_title — which repository it reads', () => {
	it('reads the current repository when no repo is given', async () => {
		mocked_command.mockResolvedValueOnce(`"${ISSUE_TITLE}"`)

		await expect(git_gh_issue.issue_get_title('903')).resolves.toBe(ISSUE_TITLE)
		expect(mocked_command).toHaveBeenCalledWith([
			'issue',
			'view',
			'903',
			'--json',
			'title',
			'--jq',
			'.title',
		])
	})

	it('reads the named repository when one is given', async () => {
		mocked_command.mockResolvedValueOnce(`"${ISSUE_TITLE}"`)

		await git_gh_issue.issue_get_title('431', OTHER_REPO)

		expect(mocked_command).toHaveBeenCalledWith([
			'issue',
			'view',
			'431',
			'--repo',
			OTHER_REPO,
			'--json',
			'title',
			'--jq',
			'.title',
		])
	})
})
