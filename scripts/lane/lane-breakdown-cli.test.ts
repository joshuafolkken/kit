import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_breakdown_cli } from './lane-breakdown-cli'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#4995: `josh lane:breakdown <issue>` prints a merged lane's net time by stage, the
// same breakdown its overrun investigation comments on its Issue.

const mocks = vi.hoisted(() => ({
	evidence: vi.fn(),
	closing: vi.fn(),
	all_events: vi.fn(),
	read_entries: vi.fn<(path: string) => ReadonlyArray<LedgerEntry>>(),
	read_archive: vi.fn<(path: string) => ReadonlyArray<LedgerEntry>>(),
	target: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock('./historical-evidence', () => ({ historical_evidence: { read: mocks.evidence } }))
vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_number_result: mocks.closing },
}))

vi.mock(import('./lane-ledger'), async (import_original) => {
	const { lane_ledger } = await import_original()

	// The archive beside the ledger (`lane-ledger-archive.ts`) is read apart.
	function read_entries(file: string): ReadonlyArray<LedgerEntry> {
		return file.endsWith('-archive.jsonl') ? mocks.read_archive(file) : mocks.read_entries(file)
	}

	return { lane_ledger: { ...lane_ledger, read_entries, target: mocks.target } }
})
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { all_events: mocks.all_events },
}))
vi.mock(import('./lane-breakdown-implement'), async (import_original) => {
	const { lane_breakdown_implement } = await import_original()

	return { lane_breakdown_implement: { ...lane_breakdown_implement, read: () => [] } }
})

const ISSUE = 4970
const FAILURE = 1
const START = Date.parse('2026-10-26T05:43:00.000Z')
const MINUTE_MS = 60_000
const JOSH_GATE = 'josh gate'
const SHIP_STAGE = 'ship-stage'
const TIMELINE = [String(ISSUE), '--timeline']

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function gate_lap(ended: number, minutes: number, step: string): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: at(ended),
		issue: ISSUE,
		stage: 'gate',
		step,
		elapsed_ms: minutes * MINUTE_MS,
	}
}

beforeEach(() => {
	mocks.evidence.mockResolvedValue({ evidence: [], unreadable: [] })
	mocks.closing.mockResolvedValue({ kind: 'read', number: undefined })
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	mocks.target.mockResolvedValue('/ledger.jsonl')
	mocks.read_archive.mockReturnValue([])
	mocks.all_events.mockResolvedValue([
		{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` },
	])
	mocks.read_entries.mockReturnValue([
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(61), issue: ISSUE },
	])
})

describe('lane_breakdown_cli.run — human wait', () => {
	it.each([{ args: [String(ISSUE)] }, { args: TIMELINE }])(
		'reports park events as human wait: $args',
		async ({ args }) => {
			mocks.all_events.mockResolvedValue([
				{ pos: 1, at: at(5), kind: 'park', text: `#${String(ISSUE)} parked on a decision` },
			])
			mocks.read_entries.mockReturnValue([
				{ kind: 'dispatch', at: at(0), issue: ISSUE },
				{ kind: 'dispatch', at: at(15), issue: ISSUE },
				{ kind: 'merge', at: at(61), issue: ISSUE },
			])

			await expect(lane_breakdown_cli.run(args)).resolves.toBe(0)
			expect(console.info).toHaveBeenCalledWith(expect.stringContaining('human wait 10.0 min'))
		},
	)
})

describe('lane_breakdown_cli.run', () => {
	it('prints the stages longest first under the net minutes', async () => {
		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			[
				'Net time by stage, longest first, 61 min of net time (`pnpm josh lane:breakdown 4970`):',
				'',
				'- implement 51.0 min, over budget +42 min (editing & thinking 51.0 min)',
				'- start to plan 10.0 min, over budget +7 min',
				'- waits taken out (park, outage, usage limit, yield, split run, host sleep) 0.0 min, of which yield wait 0.0 min, of which host sleep 0.0 min',
				'End-to-end 61.0 min (over target); target 30 min dispatch to merge (human wait reported separately, included); internal stage budgets 25 min (plan 3 + implement 9 + ship 8 + followup 5)',
				'Exclusive wall clock: off-tool work 0.0 min; automatic wait 0.0 min; human wait 0.0 min; unclassified (missing transcripts) 61.0 min',
				'Tool cumulative 0.0 min (parallel calls overlap; not additive to wall clock). Off-tool work includes unrecorded activity; automatic wait includes tool responses, gate, CI, yield, outage and sleep. Legacy net excludes more than human wait.',
				'- Largest time sinks (stages and laps overlap): implement 51.0 min; start to plan 10.0 min',
			].join('\n'),
		)
	})

	// joshuafolkken/kit#7038: a dispatch a rotation moved into the archive still starts the lane.
	it('reads a lane whose dispatch only the archive holds', async () => {
		mocks.read_archive.mockReturnValue([{ kind: 'dispatch', at: at(0), issue: ISSUE }])
		mocks.read_entries.mockReturnValue([{ kind: 'merge', at: at(61), issue: ISSUE }])

		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('61 min of net time'))
	})

	it('refuses a lane the ledger holds no dispatch and merge of', async () => {
		mocks.read_entries.mockReturnValue([])

		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no dispatch and merge'))
	})

	it('prints the usage for anything but one issue number', async () => {
		await expect(lane_breakdown_cli.run([])).resolves.toBe(FAILURE)
		await expect(lane_breakdown_cli.run(['x'])).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_breakdown_cli.USAGE)
	})
})

// joshuafolkken/kit#7186: `--timeline` prints the lane in time order instead of by stage.
describe('lane_breakdown_cli.run — --timeline', () => {
	it('prints the lane in time order under its header', async () => {
		await expect(lane_breakdown_cli.run(TIMELINE)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\[#4970\]\(.*\) timeline .*\n2026-10-26 05:43Z +\+0\.0 +10\.0 min {2}start to plan\n/u,
			),
		)
	})

	it('recovers ship and followup from archived ledger rows after event compaction', async () => {
		mocks.read_archive.mockReturnValue([
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			{ kind: 'stage', at: at(30), issue: ISSUE, stage: 'gate', elapsed_ms: 10 * MINUTE_MS },
			{ kind: 'stage', at: at(60), issue: ISSUE, stage: 'followup', elapsed_ms: 20 * MINUTE_MS },
		])
		mocks.read_entries.mockReturnValue([{ kind: 'merge', at: at(61), issue: ISSUE }])

		await expect(lane_breakdown_cli.run(TIMELINE)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('ship gate'))
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('driver followup (CI wait)'))
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('End-to-end 61.0 min (over target)'),
		)
	})

	it('refuses a lane the ledger holds no merge of', async () => {
		mocks.read_entries.mockReturnValue([{ kind: 'dispatch', at: at(0), issue: ISSUE }])

		await expect(lane_breakdown_cli.run(TIMELINE)).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('refuses an unknown flag with the usage', async () => {
		await expect(lane_breakdown_cli.run([String(ISSUE), '--other'])).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_breakdown_cli.USAGE)
	})
})

it('prints comment, commit and log sources without changing the ledger (ac-89e55522)', async () => {
	const entries: ReadonlyArray<LedgerEntry> = []

	mocks.read_entries.mockReturnValue(entries)
	mocks.all_events.mockResolvedValue([])
	mocks.closing.mockResolvedValue({ kind: 'read', number: 1 })
	mocks.evidence.mockResolvedValue({
		evidence: [
			{ kind: 'handoff', at: at(0), source: 'comment/1' },
			{ kind: 'plan', at: at(10), source: 'comment/2' },
			{ kind: 'commit', at: at(20), source: 'commit/1' },
			{ kind: 'ship-review', at: at(50), source: '/review.log:1' },
			{ kind: 'merge', at: at(61), source: 'pull/1' },
		],
		unreadable: [],
	})

	await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(0)

	expect(console.info).toHaveBeenCalledWith(
		expect.stringMatching(
			/^Estimated timeline.*\nSources: handoff: comment\/1; plan: comment\/2; commit: commit\/1; ship-review: \/review.log:1; merge: pull\/1/u,
		),
	)
	expect(console.info).toHaveBeenCalledWith(expect.stringContaining('implement 40.0 min'))
	expect(console.info).toHaveBeenCalledWith(expect.stringContaining('ship review 11.0 min'))
	expect(entries).toEqual([])
})

it.each(['dispatch', 'merge'] as const)(
	'fills only the missing %s boundary (ac-4b1b2d87)',
	async (kind) => {
		mocks.read_entries.mockReturnValue([
			{
				kind: kind === 'dispatch' ? 'merge' : 'dispatch',
				at: at(kind === 'dispatch' ? 61 : 0),
				issue: ISSUE,
			},
		])
		mocks.evidence.mockResolvedValue({
			evidence: [
				{ kind: 'handoff', at: at(10), source: 'comment/1' },
				{ kind: 'merge', at: at(50), source: 'pull/1' },
			],
			unreadable: [],
		})

		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(0)

		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining(`${kind === 'dispatch' ? '51' : '50'} min of net time`),
		)
	},
)

it.each(['read', 'unreadable'] as const)(
	'reports PR discovery status with insufficient evidence: %s (ac-4b1b2d87)',
	async (kind) => {
		mocks.read_entries.mockReturnValue([])
		mocks.closing.mockResolvedValue({ kind, number: undefined })
		mocks.evidence.mockResolvedValue({ evidence: [], unreadable: [] })

		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(FAILURE)

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(
				`unreadable: ${kind === 'read' ? 'none' : 'closing pull request discovery'}`,
			),
		)
	},
)

it('explains insufficient evidence and unreadable sources (ac-4b1b2d87)', async () => {
	mocks.read_entries.mockReturnValue([])
	mocks.evidence.mockResolvedValue({
		evidence: [{ kind: 'commit', at: at(10), source: 'commit/1' }],
		unreadable: ['pull', 'logs'],
	})

	await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(FAILURE)

	expect(console.info).not.toHaveBeenCalled()
	expect(console.error).toHaveBeenCalledWith(
		expect.stringContaining('Insufficient historical evidence'),
	)
	expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unreadable: pull, logs'))
})

// joshuafolkken/kit#6303: reuse the sinks classification, with overlapping laps summed by name.
describe('lane_breakdown_cli.run time sinks', () => {
	it('prints the largest three sinks descending after aggregating repeated lap names', async () => {
		mocks.all_events.mockResolvedValue([
			{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` },
			{ pos: 2, at: at(31), kind: SHIP_STAGE, text: `#${String(ISSUE)} gate start` },
			{ pos: 3, at: at(61), kind: SHIP_STAGE, text: `#${String(ISSUE)} gate done` },
		])
		mocks.read_entries.mockReturnValue([
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			gate_lap(51, 20, JOSH_GATE),
			gate_lap(56, 5, `${JOSH_GATE} (reused)`),
			{ kind: 'merge', at: at(61), issue: ISSUE },
		])

		await lane_breakdown_cli.run([String(ISSUE)])

		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining(
				'\n- Largest time sinks (stages and laps overlap): ship gate 30.0 min; josh gate 25.0 min; implement 21.0 min',
			),
		)
		expect(String(vi.mocked(console.info).mock.calls[0]?.[0]).split('\n').at(-1)).not.toContain(
			'start to plan',
		)
	})

	it('prints a single available sink without padding', async () => {
		mocks.all_events.mockResolvedValue([])

		await lane_breakdown_cli.run([String(ISSUE)])

		expect(console.info).toHaveBeenCalledWith(
			expect.stringMatching(
				/\n- Largest time sinks \(stages and laps overlap\): start to plan 61\.0 min$/u,
			),
		)
	})
})

// joshuafolkken/kit#5661: a lane that cut ends with its cuts by phase; one that never cut prints as above.
describe('lane_breakdown_cli.run on a lane that cut', () => {
	it('ends with the cuts counted by the phase each cut at', async () => {
		const lane = `#${String(ISSUE)}`

		mocks.all_events.mockResolvedValue([
			{ pos: 1, at: at(10), kind: 'plan', text: `${lane} plan` },
			{ pos: 2, at: at(20), kind: 'cut', text: `${lane} cut (implementation)` },
			{ pos: 3, at: at(50), kind: 'cut', text: `${lane} cut (pre-gate)` },
			{ pos: 4, at: at(52), kind: 'cut', text: '#1 cut (pre-gate)' },
		])

		await lane_breakdown_cli.run([String(ISSUE)])

		expect(console.info).toHaveBeenCalledWith(
			expect.stringMatching(/\n- run:cut ×2 \(implementation ×1, pre-gate ×1\)$/u),
		)
	})
})

// joshuafolkken/kit#5078: the pre-detach line names what its test:pinned probe spent.
describe('lane_breakdown_cli.run on a lane whose ship pre-detach probed', () => {
	it("prints the test:pinned row written inside the stage on that stage's line", async () => {
		const lane = `#${String(ISSUE)}`

		mocks.all_events.mockResolvedValue([
			{ pos: 1, at: at(10), kind: 'plan', text: `${lane} plan` },
			{ pos: 2, at: at(50), kind: SHIP_STAGE, text: `${lane} pre-detach start` },
			{ pos: 3, at: at(55), kind: SHIP_STAGE, text: `${lane} pre-detach done` },
		])
		mocks.read_entries.mockReturnValue([
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			{ kind: 'test-pinned', at: at(54), issue: ISSUE, held: 1, probes: [], elapsed_ms: 1 },
			{ kind: 'merge', at: at(61), issue: ISSUE },
		])

		await lane_breakdown_cli.run([String(ISSUE)])

		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining(
				'- ship pre-detach 5.0 min (test:pinned 1 hunks, 1 cached, 0 probed)',
			),
		)
	})
})
