import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_issue_mock = vi.hoisted(() => vi.fn())
const is_pending_mock = vi.hoisted(() => vi.fn())
const prrun_token_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('./run-halfrun-resume', () => ({ run_halfrun_resume: { is_pending: is_pending_mock } }))
vi.mock('./run-prrun-resume', () => ({ run_prrun_resume: { resume_token: prrun_token_mock } }))

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
})

describe('run_stage_read.read_stage — the planned mark (joshuafolkken/kit#3042)', () => {
	it('reads the kickoff label as planned', async () => {
		read_issue_mock.mockResolvedValue(open_with([PLANNED_LABEL]))

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
