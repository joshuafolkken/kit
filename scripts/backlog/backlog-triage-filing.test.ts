import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { record: vi.fn(async () => 'already') },
}))
vi.mock('#scripts/issue/prepared-prerequisite', () => ({
	prepared_prerequisite: { refusal: vi.fn(), publish: vi.fn(), NOT_PREPARED: 'not prepared' },
}))

const { issue_state_cli } = await import('#scripts/issue/issue-state-cli')
const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { prepared_prerequisite } = await import('#scripts/issue/prepared-prerequisite')
const { backlog_triage_filing } = await import('./backlog-triage-filing')

const ISSUE = '7729'
const FILED = 7780
const UNPLANNED = 'Prepared #7780 needs its recorded plan: nothing was written.'

function state_of(state: string): void {
	vi.mocked(issue_state_cli.read_issue).mockResolvedValue({
		kind: 'state',
		state: { state, labels: [], is_human_review: false },
	})
}

beforeEach(() => {
	state_of('OPEN')
	vi.mocked(prepared_prerequisite.refusal).mockResolvedValue(undefined)
	vi.mocked(prepared_prerequisite.publish).mockResolvedValue(prepared_prerequisite.NOT_PREPARED)
})

// joshuafolkken/kit#8222: the adopt path waited on a prepared #8178 with no plan, which never published.
describe('backlog_triage_filing — a prepared filed Issue', () => {
	it('refuses --done naming a prepared Issue with no recorded plan', async () => {
		vi.mocked(prepared_prerequisite.refusal).mockResolvedValue(UNPLANNED)

		await expect(backlog_triage_filing.problem_of(ISSUE, `filed #${String(FILED)}`)).resolves.toBe(
			UNPLANNED,
		)
		expect(prepared_prerequisite.refusal).toHaveBeenCalledWith(String(FILED), {
			outcome: 'nothing was written.',
			rerun: 'rerun this triage',
		})
	})

	it('publishes the epic listing a planned prepared Issue after the wait is recorded', async () => {
		vi.mocked(prepared_prerequisite.publish).mockResolvedValue({ epic: 7, reason: undefined })

		await expect(backlog_triage_filing.block(ISSUE, `filed #${String(FILED)}`)).resolves.toMatch(
			/^already · published \[#7\]/u,
		)
	})

	it('names the reason and the next command when the publish is withheld', async () => {
		vi.mocked(prepared_prerequisite.publish).mockResolvedValue({ epic: 7, reason: 'no epic plan' })

		await expect(backlog_triage_filing.publish_after(String(FILED))).resolves.toContain(
			' not published: no epic plan — next: `pnpm josh issue:file --publish 7`',
		)
	})

	it('reports a failed read as withheld, the wait already standing', async () => {
		vi.mocked(prepared_prerequisite.publish).mockRejectedValue(new Error('gh down'))

		await expect(backlog_triage_filing.publish_after(String(FILED))).resolves.toContain(
			'not published: gh down — next: `pnpm josh issue:file --publish <epic>`',
		)
	})
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

	it('skips an Issue of another repository', () => {
		expect(backlog_triage_filing.filed_of('see owner/repo#12, filed #7780')).toBe(FILED)
		expect(backlog_triage_filing.filed_of('filed owner/repo#12')).toBeUndefined()
	})
})
