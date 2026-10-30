import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_issue_mock = vi.hoisted(() => vi.fn())
const is_pending_mock = vi.hoisted(() => vi.fn())
const prrun_token_mock = vi.hoisted(() => vi.fn())
const open_pr_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('./run-halfrun-resume', () => ({ run_halfrun_resume: { is_pending: is_pending_mock } }))
vi.mock('./run-prrun-resume', () => ({ run_prrun_resume: { resume_token: prrun_token_mock } }))
vi.mock('./run-open-pr', () => ({ run_open_pr: { is_pending: open_pr_mock } }))

const { run_stage_read } = await import('./run-stage-read')
const { run_stage } = await import('./run-stage')
const { PLANNED_LABEL } = await import('#scripts/issue/issue-labels')

const ISSUE = '3042'

function open_with(labels: ReadonlyArray<string>): unknown {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

beforeEach(() => {
	read_issue_mock.mockReset()
	is_pending_mock.mockReset().mockResolvedValue(false)
	prrun_token_mock.mockReset().mockResolvedValue(undefined)
	open_pr_mock.mockReset().mockResolvedValue(false)
})

describe('run_stage_read.read_stage — an existing fullrun pull request', () => {
	it('resumes an open pull request at the gate without claiming a marked stop', async () => {
		read_issue_mock.mockResolvedValue(open_with([]))
		open_pr_mock.mockResolvedValue(true)

		const read = await run_stage_read.read_stage(ISSUE)

		expect(read.state).toBe(run_stage.PR_OPEN)
		expect(run_stage.decide(read.state, 'fullrun').start).toBe('gate')
		expect(read.prrun_token).toBeUndefined()
	})

	it('keeps an explicit halfrun stop without reading another pull request', async () => {
		read_issue_mock.mockResolvedValue(open_with([]))
		is_pending_mock.mockResolvedValue(true)

		const read = await run_stage_read.read_stage(ISSUE)

		expect(read.state).toBe(run_stage.HALFRUN_STOPPED)
		expect(open_pr_mock).not.toHaveBeenCalled()
	})
})

describe('run_stage_read.read_stage — the planned mark (joshuafolkken/kit#3042)', () => {
	it('reads the kickoff label as planned', async () => {
		read_issue_mock.mockResolvedValue(open_with([PLANNED_LABEL]))

		const read = await run_stage_read.read_stage(ISSUE)

		expect(read.state).toBe(run_stage.PLANNED)
	})

	it('reads the kickoff label as planned whatever its letter case on GitHub', async () => {
		read_issue_mock.mockResolvedValue(open_with([PLANNED_LABEL.toUpperCase()]))

		const read = await run_stage_read.read_stage(ISSUE)

		expect(read.state).toBe(run_stage.PLANNED)
	})

	it('reads a bare planned roadmap label as fresh, not as a posted plan', async () => {
		read_issue_mock.mockResolvedValue(open_with(['planned']))

		expect(PLANNED_LABEL).not.toBe('planned')
		const read = await run_stage_read.read_stage(ISSUE)

		expect(read.state).toBe(run_stage.FRESH)
	})
})
