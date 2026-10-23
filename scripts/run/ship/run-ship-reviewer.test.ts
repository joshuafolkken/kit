import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const write_text_stamp = vi.hoisted(() => vi.fn())
const read_stamp_text = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text,
		remove_stamp: vi.fn(),
		stamp_path: (prefix: string) => `stamps/${prefix}x`,
		write_text_stamp,
	},
}))
vi.mock('#scripts/agent/agent-argv', () => ({
	agent_argv: {
		review_in: () => ({
			kind: 'argv',
			argv: { command: 'claude', args: [] },
			profile: {
				provider: 'anthropic',
				role: 'reviewer',
				model: 'claude-opus-5-5',
				effort: 'high',
			},
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))

const { run_ship_reviewer } = await import('./run-ship-reviewer')
const { run_ship_stop_cause } = await import('./run-ship-stop-cause')

const OK = 0
const FAILED = 1
const ISSUE = '4276'
const OPEN = ['review:brief', '--interaction']
const { CAUSE } = run_ship_stop_cause

function prompt_of(brief_path: string): string {
	return `read ${brief_path}`
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: 'the brief' })
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	write_text_stamp.mockReset()
	read_stamp_text.mockReset().mockReturnValue('')
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

describe('run_ship_reviewer.tagged', () => {
	it('keeps a passing result untagged', () => {
		expect(run_ship_reviewer.tagged(CAUSE.CHECK, { code: OK, out: '' })).toEqual({
			code: OK,
			out: '',
		})
	})

	it("tags a failing result with the step's cause", () => {
		expect(run_ship_reviewer.tagged(CAUSE.ATTEST, { code: FAILED, out: 'x' })).toHaveProperty(
			'cause',
			CAUSE.ATTEST,
		)
	})

	it('tags a failing phase the same way', async () => {
		const phase = run_ship_reviewer.tagged_phase(CAUSE.CHECK, async () => ({
			code: FAILED,
			out: '',
		}))

		expect(await phase()).toHaveProperty('cause', CAUSE.CHECK)
	})
})

describe('run_ship_reviewer.reviewed', () => {
	it('hands the reviewer the brief the open command printed', async () => {
		const [open, review] = run_ship_reviewer.reviewed(
			OPEN,
			prompt_of,
			ISSUE,
			run_ship_reviewer.ROUND_ONE,
		)

		expect(await open?.()).toHaveProperty('code', OK)
		expect(await review?.()).toHaveProperty('code', OK)
		expect(josh_run_mock).toHaveBeenCalledWith(OPEN, true)
		expect(write_text_stamp).toHaveBeenCalledWith(expect.any(String), 'the brief')
	})

	it('books a reviewer that exited non-zero as infrastructure, not a finding', async () => {
		launch.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: FAILED })
		read_stamp_text.mockReturnValue(undefined)
		const [, review] = run_ship_reviewer.reviewed([], prompt_of, ISSUE, run_ship_reviewer.ROUND_TWO)

		expect(await review?.()).toHaveProperty('cause', CAUSE.INFRA)
	})
})

// joshuafolkken/kit#4562: a session that failed after writing its findings keeps that review.
describe('run_ship_reviewer.reviewed — a session that failed after writing its findings', () => {
	it('books a non-zero exit with an unreadable findings file as infrastructure', async () => {
		launch.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: FAILED })
		read_stamp_text.mockReturnValue('half a line')
		const [, review] = run_ship_reviewer.reviewed([], prompt_of, ISSUE, run_ship_reviewer.ROUND_ONE)

		expect(await review?.()).toHaveProperty('cause', CAUSE.INFRA)
	})

	it('keeps the review of a reviewer that wrote its findings before it failed', async () => {
		launch.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: FAILED })
		read_stamp_text.mockReturnValue('tests:medium:src/a.test.ts:3 — misses the empty case')
		const [, review] = run_ship_reviewer.reviewed([], prompt_of, ISSUE, run_ship_reviewer.ROUND_ONE)

		expect(await review?.()).toEqual({ code: OK, out: '' })
	})

	it('keeps the clean review of a reviewer that wrote an empty findings file before it failed', async () => {
		launch.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: FAILED })
		read_stamp_text.mockReturnValue('')
		const [, review] = run_ship_reviewer.reviewed([], prompt_of, ISSUE, run_ship_reviewer.ROUND_ONE)

		expect(await review?.()).toEqual({ code: OK, out: '' })
	})
})

// joshuafolkken/kit#4672: side-by-side reviewers — a failed one is judged on its own slot's findings.
describe('run_ship_reviewer.reviewed_together — a slot that failed after writing its findings', () => {
	const OPENS = [
		{ open: ['run:review'], slot: 'code' },
		{ open: OPEN, slot: 'interaction' },
	] as const

	// The code reviewer passes; the interaction one fails with `interaction` as its findings file.
	async function review_with(
		code: string | undefined,
		interaction: string | undefined,
	): Promise<unknown> {
		launch
			.mockResolvedValueOnce({ kind: 'completed', pid: 1, exit_code: OK })
			.mockResolvedValueOnce({ kind: 'completed', pid: 2, exit_code: FAILED })
		read_stamp_text.mockImplementation((path: string) =>
			path.includes('interaction-') ? interaction : code,
		)
		const phases = run_ship_reviewer.reviewed_together(
			OPENS,
			prompt_of,
			ISSUE,
			run_ship_reviewer.ROUND_ONE,
		)

		return await phases.at(-1)?.()
	}

	it('keeps it while the sibling slot is still writing', async () => {
		expect(await review_with(undefined, 'tests:medium:src/a.test.ts:3 — misses it')).toEqual({
			code: OK,
			out: '',
		})
	})

	it('books it as infrastructure when its own findings are unreadable', async () => {
		expect(await review_with('', undefined)).toHaveProperty('cause', CAUSE.INFRA)
	})
})

describe('run_ship_reviewer.attest_phase', () => {
	it('tags a refused attestation with its own cause', async () => {
		josh_run_mock.mockResolvedValue({ code: FAILED, out: 'mismatch' })

		expect(await run_ship_reviewer.attest_phase()).toHaveProperty('cause', CAUSE.ATTEST)
	})
})
