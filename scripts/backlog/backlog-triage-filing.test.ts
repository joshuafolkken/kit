import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { record: vi.fn(async () => 'already') },
}))

const { issue_state_cli } = await import('#scripts/issue/issue-state-cli')
const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { backlog_triage_filing } = await import('./backlog-triage-filing')

const ISSUE = '7729'
const FILED = 7780

function state_of(state: string): void {
	vi.mocked(issue_state_cli.read_issue).mockResolvedValue({
		kind: 'state',
		state: { state, labels: [], is_human_review: false },
	})
}

beforeEach(() => {
	state_of('OPEN')
})

// joshuafolkken/kit#7771: a filing option is adopted only once the Issue it files is open.
describe('backlog_triage_filing.problem_of', () => {
	it('accepts --done naming an open Issue', async () => {
		await expect(
			backlog_triage_filing.problem_of(ISSUE, `filed #${String(FILED)}`),
		).resolves.toBeUndefined()

		expect(issue_state_cli.read_issue).toHaveBeenCalledWith(String(FILED))
	})

	it('names the issue:file route for --done naming no Issue', async () => {
		await expect(backlog_triage_filing.problem_of(ISSUE, 'filed it')).resolves.toContain(
			`--route interrupt --found-during ${ISSUE} --blocks-finder`,
		)
	})

	it.each([
		['a closed Issue', () => state_of('CLOSED')],
		[
			'a missing Issue',
			() => vi.mocked(issue_state_cli.read_issue).mockResolvedValue({ kind: 'missing' }),
		],
	])('refuses %s', async (_case, arrange) => {
		arrange()

		await expect(backlog_triage_filing.problem_of(ISSUE, `#${String(FILED)}`)).resolves.toContain(
			'is not open',
		)
	})
})

describe('backlog_triage_filing.block', () => {
	it('records the child blocked by the filed Issue, relation only', async () => {
		await expect(backlog_triage_filing.block(ISSUE, `filed #${String(FILED)}`)).resolves.toBe(
			'already',
		)

		expect(epic_blocked_by.record).toHaveBeenCalledWith({
			issue: ISSUE,
			prerequisite: String(FILED),
			is_relation_only: true,
		})
	})

	it('reads the first Issue number --done names', () => {
		expect(backlog_triage_filing.filed_of('filed #7780, see #12')).toBe(FILED)
		expect(backlog_triage_filing.filed_of('nothing filed')).toBeUndefined()
	})
})
