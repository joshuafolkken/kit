import type { RoundTwoAnswer, RoundTwoVerdict } from '#scripts/review/review-round2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const review_in_mock = vi.hoisted(() => vi.fn())
const missing_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
// Unrecorded by default; a test that needs another answer sets it once.
const record_check_mock = vi.hoisted(() => vi.fn(async () => ({ status: 'missing' })))
const record_round_two_mock = vi.hoisted(() => vi.fn())
const stamps = vi.hoisted(() => ({
	read_stamp_text: vi.fn(),
	remove_stamp: vi.fn(),
	stamp_path: vi.fn((prefix: string) => `stamps/${prefix}x`),
	write_text_stamp: vi.fn(),
}))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: stamps }))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: review_in_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: missing_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/review/review-record', () => ({ review_record: { check: record_check_mock } }))
// Never `missing`, so these cases run no interaction review — its own are in
// `run-ship-review-interaction.test.ts` (joshuafolkken/kit#4276).
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => undefined } }
})
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_round_one: vi.fn(), record_round_two: record_round_two_mock },
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')
const { run_ship_review } = await import('./run-ship-review')
const { review_round2 } = await import('#scripts/review/review-round2')

// joshuafolkken/kit#2427: the supervised round-1 review — open, launch, join, attest, record — and each
// branch that hands control back to the agent.

const OK = 0
const FAILED = 1
const MOVED = 2
// A round with nothing to review passes, and says it ran no review so the ship does not time it.
const SKIPPED = { code: OK, is_skipped: true }
const ISSUE = '2427'
const BRIEF = 'medium\nbrief body'
const ARGV = { command: 'claude', args: ['-p', 'prompt'] }
const OPEN = 'run:review --code-only'
const JOIN = 'run:review --join'
const ATTEST = 'review:attest --check'
const RECORD = `review:record --issue ${ISSUE}`
const HIGH = 'bug-risks:high:a.ts:4'
const MEDIUM = 'bug-risks:medium:a.ts:7'
const MEDIUM_UNFIXED = 'tests:medium:b.ts'
const LOW = 'tests:low:a.ts'
const DECIDE = `review:round2 --record ${ISSUE} --json`
const LINT = 'lint:related'
const TEST = 'test:related'
const BRIEF_TWO = 'review:brief --round 2'
const SPAWN_NOTE = 'spawn failed'
const PROFILE_NOTE = 'bad model'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function answer_with(failing: string | undefined, failed_code = FAILED): void {
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const command = argv.join(' ')

		return { code: command === failing ? failed_code : OK, out: command === OPEN ? BRIEF : '' }
	})
}

async function stage(): Promise<unknown> {
	return await run_ship_review_steps.review_stage(ISSUE, false)
}

beforeEach(() => {
	josh_run_mock.mockReset()
	answer_with(undefined)
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	review_in_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: ARGV,
		profile: { provider: 'anthropic', role: 'reviewer', model: 'claude-opus-5-5', effort: 'high' },
	})
	missing_mock.mockReset().mockReturnValue([])
	is_child_mock.mockReset().mockReturnValue(false)
	stamps.read_stamp_text.mockReset().mockReturnValue('')
	stamps.write_text_stamp.mockClear()
	stamps.remove_stamp.mockClear()
	record_round_two_mock.mockClear()
})

// The recorded-round cases are in `run-ship-review-steps-reuse.test.ts` (joshuafolkken/kit#4620).

describe('run_ship_review_steps.review_stage — the clean path', () => {
	it('opens, reviews, joins, attests and records a clean round without stopping', async () => {
		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, RECORD])
		expect(stamps.write_text_stamp).toHaveBeenCalledWith(expect.any(String), BRIEF)
		expect(launch.mock.calls[0]?.[0]).toMatchObject({ argv: ARGV })
	})

	it('hands --unpinned-ok and its reason to the round-1 review it opens', async () => {
		await run_ship_review_steps.review_stage(ISSUE, false, ['--unpinned-ok', 'dead code'])

		expect(commands()[0]).toBe(`${OPEN} --unpinned-ok dead code`)
	})

	it('records Low findings and ships on', async () => {
		stamps.read_stamp_text.mockReturnValue(`${LOW}\n`)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toContain(`${RECORD} ${LOW}`)
	})

	it('launches under the round-1 reviewer, handed the brief path and the submit command', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await run_ship_review_steps.review_stage(ISSUE)

		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining('review round 1 · provider=anthropic'),
		)

		const [prompt, round] = review_in_mock.mock.calls[0] as [string, number]

		expect(round).toBe(1)
		expect(prompt).toContain('josh-ship-review-brief-')
		expect(prompt).toContain(run_ship_review.submit_command('code'))
		expect(prompt).not.toContain(FINDINGS_PREFIX)
	})
})

describe('run_ship_review_steps.review_stage — a finding or a refusal stops it', () => {
	// joshuafolkken/kit#3159: the description reaches the stopped log, never the ledger record.
	it('records a High finding by its spec, then stops and lists it with its description', async () => {
		const described = `${HIGH} — the handle leaks on the early return`

		stamps.read_stamp_text.mockReturnValue(described)

		expect(await stage()).toHaveProperty('out', expect.stringContaining(described))
		expect(commands()).toContain(`${RECORD} ${HIGH}`)
	})

	// joshuafolkken/kit#4431: a stop on no finding is tagged with its step's own cause.
	it.each([
		[JOIN, 'check'],
		[ATTEST, 'attest'],
		[RECORD, 'check'],
	])('stops at a failed `%s` without recording, tagged %s', async (failing, cause) => {
		answer_with(failing)

		expect(await stage()).toHaveProperty('cause', cause)
		expect(commands().at(-1)).toBe(failing)
	})

	it('stops when the brief is refused, launching no reviewer', async () => {
		answer_with(OPEN)

		expect(await stage()).toHaveProperty('cause', 'check')
		expect(launch).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4774: the stop names the path, ahead of a join that would read `Gate RED`.
	it('stops on an unfinished review (no findings file) at the reviewer, naming its path', async () => {
		stamps.read_stamp_text.mockReturnValue(undefined)

		const stopped = await stage()

		expect(stopped).toHaveProperty('cause', 'infra')
		expect(stopped).toHaveProperty('out', expect.stringContaining(FINDINGS_PREFIX))
		expect(commands()).toStrictEqual([OPEN])
	})
})

describe('run_ship_review_steps.review_stage — a reviewer error stops it', () => {
	it('stops when the reviewer could not start', async () => {
		launch.mockResolvedValue({ kind: 'failed', note: SPAWN_NOTE })

		expect(await stage()).toHaveProperty('out', expect.stringContaining(SPAWN_NOTE))
	})

	it('stops when the reviewer profile is rejected', async () => {
		review_in_mock.mockReturnValue({ kind: 'rejected', note: PROFILE_NOTE })

		expect(await stage()).toHaveProperty('out', expect.stringContaining(PROFILE_NOTE))
		expect(launch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2489: a round-1 reviewer that fixed its local Mediums hands the ship on rather
// than back — the join drains a gate that read the pre-fix tree, and the round is recorded as passing.
describe('run_ship_review_steps.review_stage — findings fixed in place', () => {
	const FIXED_MEDIUM = `fixed ${MEDIUM}`

	it('records a fixed Medium and ships on, draining a join the fixes turned red', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		answer_with(JOIN)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, `${RECORD} ${FIXED_MEDIUM}`])
	})

	// joshuafolkken/kit#4774: the join's own code says the tree moved after a green gate.
	it('ships on past a join whose gate passed before the tree moved, whatever the findings say', async () => {
		answer_with(JOIN, MOVED)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, RECORD])
	})

	// joshuafolkken/kit#4770: the background `test:pinned` answers at the join; a fix moved the tree,
	// not that answer.
	it('stops at a join that found an unpinned change, even past a reviewer fix', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		answer_with(JOIN, 3)

		expect(await stage()).toMatchObject({ cause: 'check', code: 3 })
	})

	it('still stops at a red join when nothing was fixed', async () => {
		stamps.read_stamp_text.mockReturnValue(LOW)
		answer_with(JOIN)

		expect(await stage()).toHaveProperty('cause', 'check')
		expect(commands().at(-1)).toBe(JOIN)
	})

	// joshuafolkken/kit#2961: a partial fix still edited the tree the gate read, so the join is drained
	// and the round stops on the Medium left unfixed rather than on a misleading `Gate RED`.
	it('stops on a Medium left unfixed, after recording it, past a join the fix turned red', async () => {
		stamps.read_stamp_text.mockReturnValue(`${FIXED_MEDIUM}\n${MEDIUM_UNFIXED}`)
		answer_with(JOIN)

		expect(await stage()).toHaveProperty('cause', 'finding')
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, `${RECORD} ${MEDIUM} ${MEDIUM_UNFIXED}`])
	})
})

// joshuafolkken/kit#2500: the scoped pair is a precondition the supervisor meets itself — run in place
// when the tree has no green record, stopped on only when a check genuinely fails.
describe('run_ship_review_steps.review_stage — the scoped pair before the review', () => {
	it('runs the checks the tree has no green record for, then reviews without stopping', async () => {
		missing_mock.mockReturnValue([LINT, TEST])

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([LINT, TEST, OPEN, JOIN, ATTEST, RECORD])
	})

	it('runs only the check whose record is stale', async () => {
		missing_mock.mockReturnValueOnce([TEST])

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([TEST, OPEN, JOIN, ATTEST, RECORD])
	})

	it('stops before the review on a genuinely failing check, launching no reviewer', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_with(LINT)

		expect(await stage()).toHaveProperty('cause', 'check')
		expect(commands()).toStrictEqual([LINT])
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('run_ship_review_steps.review_stage — fixes in place are verified by the scoped pair', () => {
	const FIXED_MEDIUM = `fixed ${MEDIUM}`

	it('verifies the fixed tree and ships on when the pair is green', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)
		missing_mock.mockReturnValueOnce([]).mockReturnValueOnce([LINT, TEST])

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([OPEN, JOIN, ATTEST, LINT, TEST, `${RECORD} ${FIXED_MEDIUM}`])
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

// An empty delta skips and a live one runs: one code per verdict is enough here, since the stage
// records the code as read rather than interpreting it.
function decision_of(verdict: RoundTwoVerdict): RoundTwoAnswer {
	const code = verdict === 'skip' ? review_round2.CODE.EMPTY : review_round2.CODE.LIVE

	return { verdict, code, reason: `${code} reason` }
}

// What each command prints in a round-2 stage: the decision, the brief, and nothing for the rest.
function round_two_output(command: string, decision: RoundTwoVerdict): string {
	if (command === DECIDE) return `${review_round2.to_json(decision_of(decision))}\n`

	return command === BRIEF_TWO ? BRIEF : ''
}

function answer_round_two(decision: RoundTwoVerdict, failing?: string): void {
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const command = argv.join(' ')

		return { code: command === failing ? FAILED : OK, out: round_two_output(command, decision) }
	})
}

describe('run_ship_review_steps.round_two_stage — due or not', () => {
	it('skips when round 1 left no fix delta, launching no reviewer', async () => {
		answer_round_two('skip')

		expect(await run_ship_review_steps.round_two_stage(ISSUE)).toMatchObject(SKIPPED)
		expect(commands()).toStrictEqual([DECIDE])
		expect(launch).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4064: the skip's output stays the bare verdict and the note, as before.
	it('keeps the skipped output to the verdict and the note', async () => {
		answer_round_two('skip')

		const result = await run_ship_review_steps.round_two_stage(ISSUE)

		expect(result.out).toBe('skip\nround 2 not due — nothing left to verify; shipping on.')
	})

	it.each([
		['skip', 'empty'],
		['required', 'live'],
	] as const)('records a %s decision with its code in the lane ledger', async (verdict, code) => {
		answer_round_two(verdict)

		await run_ship_review_steps.round_two_stage(ISSUE)

		expect(record_round_two_mock).toHaveBeenCalledWith({ issue: Number(ISSUE), verdict, code })
	})

	it('stops on a decision it cannot parse, recording nothing and launching no reviewer', async () => {
		josh_run_mock.mockResolvedValue({ code: OK, out: 'skip\n' })

		expect(await run_ship_review_steps.round_two_stage(ISSUE)).toHaveProperty('cause', 'check')
		expect(record_round_two_mock).not.toHaveBeenCalled()
		expect(launch).not.toHaveBeenCalled()
	})

	it('stops at a red scoped check without launching a reviewer', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_round_two('required', TEST)

		expect(await run_ship_review_steps.round_two_stage(ISSUE)).toHaveProperty('code', FAILED)
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('run_ship_review_steps.round_two_stage — the verification pass after the commit', () => {
	it('runs the scoped pair, the round-2 brief, a fresh reviewer, attest and record', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		answer_round_two('required')

		expect(await run_ship_review_steps.round_two_stage(ISSUE)).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([DECIDE, LINT, TEST, BRIEF_TWO, ATTEST, `${RECORD} --comment`])
		expect(launch).toHaveBeenCalledOnce()
		expect(stamps.write_text_stamp).toHaveBeenCalledWith(expect.any(String), BRIEF)
		expect(review_in_mock.mock.calls[0]?.[0]).toContain('round-2 verification pass')
		expect(review_in_mock.mock.calls[0]?.[1]).toBe(2)
	})

	// joshuafolkken/kit#3645: the passing round above records with `--comment` — no commit is left for
	// its lines to ride — while a blocking one keeps the tree, where the fix's commit carries them.
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
