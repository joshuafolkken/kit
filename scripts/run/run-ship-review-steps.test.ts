import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const resolve_in_mock = vi.hoisted(() => vi.fn())
const missing_mock = vi.hoisted(() => vi.fn())
const stamps = vi.hoisted(() => ({
	read_stamp_text: vi.fn(),
	remove_stamp: vi.fn(),
	stamp_path: vi.fn((prefix: string) => `stamps/${prefix}x`),
	write_text_stamp: vi.fn(),
}))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: stamps }))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: resolve_in_mock } }))
vi.mock('./detached-launch', () => ({ detached_launch: { launch_attached: launch_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: missing_mock } }))

const { run_ship_review_steps } = await import('./run-ship-review-steps')
const { run_ship_review } = await import('./run-ship-review')

// joshuafolkken/kit#2427: the supervised round-1 review — open, launch, join, attest, record — and each
// branch that hands control back to the agent.

const OK = 0
const FAILED = 1
const ISSUE = '2427'
const BRIEF = 'medium\nbrief body'
const ARGV = { command: 'claude', args: ['-p', 'prompt'] }
const OPEN = 'run:review'
const JOIN = 'run:review --join'
const ATTEST = 'review:attest --check'
const RECORD = `review:record --issue ${ISSUE}`
const HIGH = 'bug-risks:high:a.ts:4'
const MEDIUM = 'bug-risks:medium:a.ts:7'
const MEDIUM_UNFIXED = 'tests:medium:b.ts'
const LOW = 'tests:low:a.ts'
const DECIDE = 'review:round2 --round-1-closed'
const LINT = 'lint:related'
const TEST = 'test:related'
const BRIEF_TWO = 'review:brief --round 2'
const COMPLETED = { kind: 'completed', pid: 1 } as const
const SPAWN_NOTE = 'spawn failed'
const PROFILE_NOTE = 'bad model'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function answer_with(failing: string | undefined): void {
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const command = argv.join(' ')

		return { code: command === failing ? FAILED : OK, out: command === OPEN ? BRIEF : '' }
	})
}

async function stage_code(): Promise<number> {
	const result = await run_ship_review_steps.review_stage(ISSUE)

	return result.code
}

async function stage_out(): Promise<string> {
	const result = await run_ship_review_steps.review_stage(ISSUE)

	return result.out
}

beforeEach(() => {
	josh_run_mock.mockReset()
	answer_with(undefined)
	launch_mock.mockReset().mockResolvedValue({ ...COMPLETED, exit_code: OK })
	resolve_in_mock.mockReset().mockReturnValue({ kind: 'argv', argv: ARGV, profile: undefined })
	missing_mock.mockReset().mockReturnValue([])
	stamps.read_stamp_text.mockReset().mockReturnValue('')
	stamps.write_text_stamp.mockClear()
	stamps.remove_stamp.mockClear()
})

describe('run_ship_review_steps.review_stage — the clean path', () => {
	it('opens, reviews, joins, attests and records a clean round without stopping', async () => {
		expect(await stage_code()).toBe(OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, RECORD])
		expect(stamps.write_text_stamp).toHaveBeenCalledWith(expect.any(String), BRIEF)
		expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({ argv: ARGV })
	})

	it('records Low findings and ships on', async () => {
		stamps.read_stamp_text.mockReturnValue(`${LOW}\n`)

		expect(await stage_code()).toBe(OK)
		expect(commands()).toContain(`${RECORD} ${LOW}`)
	})

	it('launches under the reviewer role, handed the brief and findings paths', async () => {
		await run_ship_review_steps.review_stage(ISSUE)

		const [prompt, role] = resolve_in_mock.mock.calls[0] as [string, string]

		expect(role).toBe('reviewer')
		expect(prompt).toContain('josh-ship-review-brief-')
		expect(prompt).toContain('josh-ship-review-findings-')
	})
})

describe('run_ship_review_steps.review_stage — a finding or a refusal stops it', () => {
	it('records a High finding, then stops and lists it', async () => {
		stamps.read_stamp_text.mockReturnValue(HIGH)

		expect(await stage_out()).toContain(HIGH)
		expect(commands()).toContain(`${RECORD} ${HIGH}`)
	})

	it.each([JOIN, ATTEST])('stops at a failed `%s` without recording', async (failing) => {
		answer_with(failing)

		expect(await stage_code()).toBe(FAILED)
		expect(commands().at(-1)).toBe(failing)
	})

	it('stops when the brief is refused, launching no reviewer', async () => {
		answer_with(OPEN)

		expect(await stage_code()).toBe(FAILED)
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('stops on an unfinished review (no findings file) without recording', async () => {
		stamps.read_stamp_text.mockReturnValue(undefined)

		expect(await stage_code()).toBe(FAILED)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST])
	})
})

describe('run_ship_review_steps.review_stage — a reviewer error stops it', () => {
	it('stops when the reviewer exits non-zero, before the join', async () => {
		launch_mock.mockResolvedValue({ ...COMPLETED, exit_code: FAILED })

		expect(await stage_code()).toBe(FAILED)
		expect(commands()).toStrictEqual([OPEN])
	})

	it('stops when the reviewer could not start', async () => {
		launch_mock.mockResolvedValue({ kind: 'failed', note: SPAWN_NOTE })

		expect(await stage_out()).toContain(SPAWN_NOTE)
	})

	it('stops when the reviewer profile is rejected', async () => {
		resolve_in_mock.mockReturnValue({ kind: 'rejected', note: PROFILE_NOTE })

		expect(await stage_out()).toContain(PROFILE_NOTE)
		expect(launch_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2489: a round-1 reviewer that fixed its local Mediums hands the ship on rather
// than back — the join drains a gate that read the pre-fix tree, and the round is recorded as passing.
describe('run_ship_review_steps.review_stage — findings fixed in place', () => {
	const FIXED_MEDIUM = `fixed ${MEDIUM}`

	it('records a fixed Medium and ships on, draining a join the fixes turned red', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		answer_with(JOIN)

		expect(await stage_code()).toBe(OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, `${RECORD} ${MEDIUM}`])
	})

	it('still stops at a red join when nothing was fixed', async () => {
		stamps.read_stamp_text.mockReturnValue(LOW)
		answer_with(JOIN)

		expect(await stage_code()).toBe(FAILED)
		expect(commands().at(-1)).toBe(JOIN)
	})

	it('stops on a Medium left unfixed, after recording it', async () => {
		stamps.read_stamp_text.mockReturnValue(`${FIXED_MEDIUM}\n${MEDIUM_UNFIXED}`)

		expect(await stage_code()).toBe(FAILED)
		expect(commands()).toContain(`${RECORD} ${MEDIUM} ${MEDIUM_UNFIXED}`)
	})
})

// joshuafolkken/kit#2500: the scoped pair is a precondition the supervisor meets itself — run in place
// when the tree has no green record, stopped on only when a check genuinely fails.
describe('run_ship_review_steps.review_stage — the scoped pair before the review', () => {
	it('runs the checks the tree has no green record for, then reviews without stopping', async () => {
		missing_mock.mockReturnValue([LINT, TEST])

		expect(await stage_code()).toBe(OK)
		expect(commands()).toStrictEqual([LINT, TEST, OPEN, JOIN, ATTEST, RECORD])
	})

	it('runs only the check whose record is stale', async () => {
		missing_mock.mockReturnValueOnce([TEST])

		expect(await stage_code()).toBe(OK)
		expect(commands()).toStrictEqual([TEST, OPEN, JOIN, ATTEST, RECORD])
	})

	it('stops before the review on a genuinely failing check, launching no reviewer', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_with(LINT)

		expect(await stage_code()).toBe(FAILED)
		expect(commands()).toStrictEqual([LINT])
		expect(launch_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_review_steps.review_stage — fixes in place are verified by the scoped pair', () => {
	const FIXED_MEDIUM = `fixed ${MEDIUM}`

	it('verifies the fixed tree and ships on when the pair is green', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		missing_mock.mockReturnValueOnce([]).mockReturnValueOnce([LINT, TEST])

		expect(await stage_code()).toBe(OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, LINT, TEST, `${RECORD} ${MEDIUM}`])
	})

	it('records a fix the pair turned down as unfixed, then stops', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		missing_mock.mockReturnValueOnce([]).mockReturnValueOnce([TEST])
		answer_with(TEST)

		const result = await run_ship_review_steps.review_stage(ISSUE)

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain(run_ship_review.UNVERIFIED_OUTCOME.note)
		expect(commands()).toContain(`${RECORD} ${MEDIUM}`)
	})

	it('runs no scoped check after a round that fixed nothing', async () => {
		stamps.read_stamp_text.mockReturnValue(LOW)

		await run_ship_review_steps.review_stage(ISSUE)

		expect(missing_mock).toHaveBeenCalledOnce()
	})
})

// What each command prints in a round-2 stage: the decision, the brief, and nothing for the rest.
function round_two_output(command: string, decision: string): string {
	if (command === DECIDE) return `${decision}\n`

	return command === BRIEF_TWO ? BRIEF : ''
}

function answer_round_two(decision: string, failing?: string): void {
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const command = argv.join(' ')

		return { code: command === failing ? FAILED : OK, out: round_two_output(command, decision) }
	})
}

async function round_two_code(): Promise<number> {
	const result = await run_ship_review_steps.round_two_stage(ISSUE)

	return result.code
}

describe('run_ship_review_steps.round_two_stage — due or not', () => {
	it('skips when round 1 left no fix delta, launching no reviewer', async () => {
		answer_round_two('skip')

		expect(await round_two_code()).toBe(OK)
		expect(commands()).toStrictEqual([DECIDE])
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('stops at a red scoped check without launching a reviewer', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_round_two('required', TEST)

		expect(await round_two_code()).toBe(FAILED)
		expect(launch_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_review_steps.round_two_stage — the verification pass after the commit', () => {
	it('runs the scoped pair, the round-2 brief, a fresh reviewer, attest and record', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_round_two('required')

		expect(await round_two_code()).toBe(OK)
		expect(commands()).toStrictEqual([DECIDE, LINT, TEST, BRIEF_TWO, ATTEST, RECORD])
		expect(launch_mock).toHaveBeenCalledOnce()
		expect(stamps.write_text_stamp).toHaveBeenCalledWith(expect.any(String), BRIEF)
		expect(resolve_in_mock.mock.calls[0]?.[0]).toContain('round-2 verification pass')
	})

	it.each([
		[MEDIUM, MEDIUM],
		[`fixed ${MEDIUM}`, MEDIUM],
		[HIGH, HIGH],
	])('stops before the followup on a round-2 %s, after recording it', async (finding, recorded) => {
		answer_round_two('required')
		stamps.read_stamp_text.mockReturnValue(finding)

		const result = await run_ship_review_steps.round_two_stage(ISSUE)

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain('round 2 is final')
		expect(commands().at(-1)).toBe(`${RECORD} ${recorded}`)
	})
})
