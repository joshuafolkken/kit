import { gate_tree } from '#scripts/gate/gate-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4276: a change to the run tooling owes the interaction review —
// `run_ship_review_steps.review_stage` runs it itself, beside round 1 (joshuafolkken/kit#4672). The
// round-1 cases are in `run-ship-review-steps.test.ts`.

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const record_check_mock = vi.hoisted(() => vi.fn())
const interaction_status_mock = vi.hoisted(() => vi.fn())
const read_stamp_text = vi.hoisted(() => vi.fn())
const mark_stopped = vi.hoisted(() => vi.fn())
const record_round_one = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text,
		remove_stamp: vi.fn(),
		stamp_path: (prefix: string) => `stamps/${prefix}x`,
		write_text_stamp: vi.fn(),
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
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: () => [] } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-record', () => ({ review_record: { check: record_check_mock } }))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: interaction_status_mock } }
})
// A recorded round 1 stands on this tree, so an `ok` record is reused (joshuafolkken/kit#4620).
vi.mock('#scripts/review/review-reviewed-tree', () => ({
	review_reviewed_tree: {
		discard: vi.fn(),
		MOVEMENT: { DELTA: 'delta', HELD: 'held', UNSETTLED: 'unsettled' },
		is_stopped_on: () => false,
		mark_stopped,
		standing_here: async () => ({ movement: 'held' }),
	},
}))
vi.mock('#scripts/lane/lane-ledger', () => ({ lane_ledger: { record_round_one } }))

const { run_ship_review_steps } = await import('./run-ship-review-steps')

const OK = 0
const FAILED = 1
const ISSUE = '4276'
const OPEN = 'run:review --code-only'
const JOIN = 'run:review --join'
const ATTEST = 'review:attest --check'
const RECORD = `review:record --issue ${ISSUE}`
const INTERACTION_BRIEF = 'review:brief --interaction'
const INTERACTION_RECORD = `${RECORD} --interaction`
const HIGH = 'bug-risks:high:scripts/run/run-board.ts:4'
const INTERACTION_HIGH = 'bug-risks:high:scripts/lane/lane-close.ts:7'
const INTERACTION_PATH = 'interaction-'
const MISSING = 'missing'
const NOT_REQUIRED = 'not-required'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

// Each slot's findings file: the interaction slot's paths carry its prefix.
function findings_by_slot(code: string, interaction: string): void {
	read_stamp_text.mockImplementation((path: string) =>
		path.includes(INTERACTION_PATH) ? interaction : code,
	)
}

async function stage(): Promise<{ code: number; out: string }> {
	return await run_ship_review_steps.review_stage(ISSUE)
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: 'brief' })
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	record_check_mock.mockReset().mockResolvedValue({ status: MISSING })
	interaction_status_mock.mockReset()
	read_stamp_text.mockReset().mockReturnValue('')
	mark_stopped.mockReset()
	record_round_one.mockReset()
	// Read through git, the tree is this checkout's change, which no case here asserts on (joshuafolkken/kit#4597).
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: {}, base: undefined })
})

describe('run_ship_review_steps.review_stage — the interaction review', () => {
	it.each([NOT_REQUIRED, 'ok'])('runs none when its status is %s', async (status) => {
		interaction_status_mock.mockResolvedValue(status)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).not.toContain(INTERACTION_BRIEF)
		expect(launch).toHaveBeenCalledOnce()
	})

	it('runs its brief and reviewer beside round 1, one join and one attest for both', async () => {
		interaction_status_mock.mockResolvedValueOnce(MISSING).mockResolvedValue('ok')

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([
			OPEN,
			INTERACTION_BRIEF,
			JOIN,
			ATTEST,
			RECORD,
			INTERACTION_RECORD,
		])
		expect(launch).toHaveBeenCalledTimes(2)
		expect(interaction_status_mock).toHaveBeenCalledWith(Number(ISSUE))
	})

	// `review:brief` takes no `--unpinned-ok`; only round 1's `run:review` carries it.
	it('hands --unpinned-ok to the round-1 review alone, not the interaction brief', async () => {
		interaction_status_mock.mockResolvedValueOnce(MISSING).mockResolvedValue('ok')

		await run_ship_review_steps.review_stage(ISSUE, false, ['--unpinned-ok', 'dead code'])

		expect(commands().slice(0, 2)).toStrictEqual([
			`${OPEN} --unpinned-ok dead code`,
			INTERACTION_BRIEF,
		])
	})
})

describe('run_ship_review_steps.review_stage — the interaction review beside round 1', () => {
	it('still runs it after a recorded round 1', async () => {
		record_check_mock.mockResolvedValue({ status: 'ok' })
		interaction_status_mock.mockResolvedValue(MISSING)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([INTERACTION_BRIEF, ATTEST, INTERACTION_RECORD])
	})

	it('stops on a High it found, after recording it', async () => {
		record_check_mock.mockResolvedValue({ status: 'ok' })
		interaction_status_mock.mockResolvedValue(MISSING)
		read_stamp_text.mockReturnValue(HIGH)

		expect(await stage()).toHaveProperty('code', FAILED)
		expect(commands().at(-1)).toBe(`${INTERACTION_RECORD} ${HIGH}`)
	})

	it('runs it alone when a round-1 fix first made it due', async () => {
		interaction_status_mock.mockResolvedValueOnce(NOT_REQUIRED).mockResolvedValue(MISSING)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([
			OPEN,
			JOIN,
			ATTEST,
			RECORD,
			INTERACTION_BRIEF,
			ATTEST,
			INTERACTION_RECORD,
		])
	})

	it('runs none after a round 1 that stopped before it was due', async () => {
		interaction_status_mock.mockResolvedValueOnce(NOT_REQUIRED).mockResolvedValue(MISSING)
		read_stamp_text.mockReturnValue(HIGH)

		expect(await stage()).toHaveProperty('code', FAILED)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, `${RECORD} ${HIGH}`])
		expect(launch).toHaveBeenCalledOnce()
	})
})

describe('run_ship_review_steps.review_stage — a High in either review beside round 1', () => {
	it('records both and stops once, carrying both findings', async () => {
		interaction_status_mock.mockResolvedValue(MISSING)
		findings_by_slot(HIGH, INTERACTION_HIGH)

		const result = await stage()

		expect(result).toHaveProperty('code', FAILED)
		expect(commands()).toContain(`${RECORD} ${HIGH}`)
		expect(commands()).toContain(`${INTERACTION_RECORD} ${INTERACTION_HIGH}`)
		expect(result.out).toContain('run-board.ts')
		expect(result.out).toContain('lane-close.ts')
		expect(mark_stopped).toHaveBeenCalledExactlyOnceWith(Number(ISSUE), true)
		expect(record_round_one).toHaveBeenCalledExactlyOnceWith({
			issue: Number(ISSUE),
			verdict: 'blocking',
		})
	})

	it('counts round 1 as fixed when only the interaction review fixed in place', async () => {
		interaction_status_mock.mockResolvedValueOnce(MISSING).mockResolvedValue('ok')
		findings_by_slot('', `fixed ${INTERACTION_HIGH.replace('high', 'medium')}`)

		expect(await stage()).toHaveProperty('code', OK)
		expect(record_round_one).toHaveBeenCalledExactlyOnceWith({
			issue: Number(ISSUE),
			verdict: 'fixed',
		})
	})

	it('stops when only the interaction review has a High', async () => {
		interaction_status_mock.mockResolvedValue(MISSING)
		findings_by_slot('', INTERACTION_HIGH)

		expect(await stage()).toHaveProperty('code', FAILED)
		expect(commands()).toContain(RECORD)
		expect(commands().at(-1)).toBe(`${INTERACTION_RECORD} ${INTERACTION_HIGH}`)
	})
})
