import { randomUUID } from 'node:crypto'
import { process_identity } from '#scripts/josh/process-identity'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic, type PinnedReport } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_join_read } from './run-review-join-read'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_remaining } from './run-review-pinned-remaining'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// #7427 dispatch:976 launched eight remaining hunks; :991 recorded fixes before that probe ended.
// :1001 was the next visible list. These fixtures move that collection to the join/record boundary.
const ROOT = `/remaining-${randomUUID()}`
const TREE = 'first-tree'
const FIXED_TREE = 'fixed-tree'
const PID = 7438
const EXISTING_LOST = 'existing lost process'
const LOST = 'lost process'
const MOVED_TEXT = 'tree moved'
const CACHED: PinnedReport = {
	unpinned: [
		{
			file: 'first.ts',
			new_start: 3,
			new_count: 1,
			old_lines: ['old'],
			is_green: true,
			related_tests: ['first.test.ts'],
		},
	],
	stopped: [],
	unchecked: [],
	unparsed: [],
	max_hunks: test_pinned_logic.DEFAULT_MAX_HUNKS,
	has_runner: true,
}
const FIRST = test_pinned_record.summary_of(CACHED).text
const LATER = 'unpinned later.ts:9 — tests: later.test.ts\n'
const CUT: PinnedSummary = {
	text: FIRST,
	unpinned: test_pinned_record.summary_of(CACHED).unpinned,
	is_cut: true,
	remaining: 1,
}
const WHOLE: PinnedSummary = {
	text: `${FIRST}${LATER}unchecked capped.ts:1 — over hunk cap\n`,
	counts: 'unpinned 2 · unchecked 1',
	unpinned: ['first', 'later'],
	is_unchecked: true,
}

function answer_launch(): void {
	vi.spyOn(run_review_steps, 'launch_josh').mockImplementation((argv) => {
		test_pinned_record.write(String(argv.at(-1)), WHOLE, ROOT)

		return { kind: 'launched', pid: PID }
	})
}

async function prepare_failure(note: string): Promise<void> {
	vi.mocked(test_pinned.cached).mockResolvedValue(CACHED)
	if (note === EXISTING_LOST) await run_review_pinned_remaining.start(ROOT)
	vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue(CUT)

	if (note === 'no spawn') {
		vi.mocked(run_review_steps.launch_josh).mockReturnValue({ kind: 'failed', note })
	}

	vi.spyOn(run_review_pinned_steps, 'wait_alone').mockResolvedValue(
		test_pinned_record.not_run_summary(note),
	)
}

function prepare_lane_read(): void {
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(run_review_pinned_steps, 'is_remaining').mockReturnValue(true)
	vi.spyOn(run_review_pinned_steps, 'launched_tree').mockReturnValue(TREE)
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
}

beforeEach(() => {
	vi.spyOn(test_pinned, 'cached').mockResolvedValue({ ...CACHED, unpinned: [] })
	vi.spyOn(process_identity, 'read_start').mockReturnValue('start')
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(TREE)
	answer_launch()
})

afterEach(() => {
	run_review_pinned_steps.clear(ROOT)
	vi.restoreAllMocks()
})

describe('run_review_pinned_remaining.collect', () => {
	it('collects every verdict at the join, including related tests and unchecked reasons', async () => {
		vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue(CUT)
		const joined = await run_review_join_read.read(ROOT, true)

		expect(joined).toMatchObject({
			summary: WHOLE,
			is_stop: true,
			text: expect.stringContaining(LATER),
		})
		expect(run_review_steps.launch_josh).toHaveBeenCalledWith(
			expect.not.arrayContaining(['--first-unpinned']),
			expect.any(String),
			ROOT,
		)
	})

	it('reuses the same complete answer on the same tree without another probe', async () => {
		await run_review_pinned_remaining.collect(CUT, ROOT)
		vi.mocked(run_review_steps.launch_josh).mockClear()

		expect(await run_review_join_read.read_finished(ROOT)).toMatchObject({ summary: WHOLE })
		expect(await run_review_pinned_remaining.read(ROOT)).toEqual(WHOLE)
		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})
})

describe('run_review_pinned_remaining.collect incomplete answers and reasons', () => {
	it('preserves a stopping cut when the continuation cannot launch', async () => {
		vi.mocked(run_review_steps.launch_josh).mockReturnValue({ kind: 'failed', note: 'no spawn' })

		expect(await run_review_pinned_remaining.collect(CUT, ROOT)).toMatchObject({
			unpinned: CUT.unpinned,
			is_cut: true,
			text: expect.stringContaining('no spawn'),
		})
	})

	it('reuses an already launched continuation instead of starting a parallel one', async () => {
		await run_review_pinned_remaining.start(ROOT)
		vi.mocked(run_review_steps.launch_josh).mockClear()

		expect(await run_review_pinned_remaining.collect(CUT, ROOT)).toEqual(WHOLE)
		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})

	it('keeps timeout and lost-process answers incomplete with the known unpinned place', async () => {
		vi.spyOn(run_review_pinned_steps, 'wait_alone').mockResolvedValue(
			test_pinned_record.not_run_summary('timeout: remaining probe did not finish'),
		)

		expect(await run_review_pinned_remaining.collect(CUT, ROOT)).toMatchObject({
			unpinned: CUT.unpinned,
			is_cut: true,
			text: expect.stringContaining('timeout'),
		})
	})

	it('leaves reason-bearing cuts to the existing whole-probe judgment', async () => {
		vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue('dead code deletion')

		expect(await run_review_pinned_remaining.collect(CUT, ROOT)).toBe(CUT)
		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})
})

describe('run_review_pinned_remaining.read across tree changes', () => {
	it('settles the old probe before a whole current-tree continuation, never returning the old answer', async () => {
		await run_review_pinned_remaining.start(ROOT)
		vi.mocked(run_review_pinned_tree.key).mockResolvedValue(FIXED_TREE)
		const fixed = { ...WHOLE, text: 'current tree', unpinned: ['new-place'] }

		vi.mocked(run_review_steps.launch_josh).mockImplementation((argv) => {
			test_pinned_record.write(String(argv.at(-1)), fixed, ROOT)

			return { kind: 'launched', pid: PID }
		})
		const settle = vi.spyOn(run_review_pinned_steps, 'wait_alone')

		vi.mocked(process_identity.is_same_process).mockReturnValue(true)
		vi.spyOn(process, 'kill').mockReturnValue(true)

		expect(await run_review_pinned_remaining.read(ROOT)).toEqual(fixed)
		expect(settle).toHaveBeenCalledWith(ROOT)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
	})

	it('does not return a successful answer if the tree changes while waiting', async () => {
		await run_review_pinned_remaining.start(ROOT)
		vi.spyOn(run_review_pinned_steps, 'wait_alone').mockImplementation(async () => {
			vi.mocked(run_review_pinned_tree.key).mockResolvedValue(FIXED_TREE)

			return WHOLE
		})

		expect(await run_review_pinned_remaining.read(ROOT)).toMatchObject({
			is_unchecked: true,
			text: expect.stringContaining(MOVED_TEXT),
		})
	})

	it('does not wait or launch where no remaining probe exists', async () => {
		expect(await run_review_pinned_remaining.read(ROOT)).toBeUndefined()
		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})
})

describe('run_review_pinned_remaining failure refusal', () => {
	it.each(['no spawn', 'timeout', LOST, EXISTING_LOST])(
		'keeps known current-tree unpinned stopping through join and lane pinned: %s',
		async (note) => {
			await prepare_failure(note)
			const joined = await run_review_join_read.read(ROOT, true)

			expect(joined).toMatchObject({ is_stop: true, summary: { unpinned: CUT.unpinned } })
			expect(joined?.text).toContain(FIRST)
			expect(joined?.text).toContain(note)
			prepare_lane_read()
			expect(await run_review_join_read.read_finished(ROOT)).toMatchObject({
				is_stop: true,
				summary: { is_cut: true, is_unchecked: true },
			})

			expect(await run_review_cli.run(['--pinned'])).toBe(3)
			expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('first.ts:3'))
		},
	)

	it('discards the known cut if the tree moves during a failed continuation', async () => {
		vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue(CUT)
		vi.spyOn(run_review_pinned_steps, 'wait_alone').mockImplementation(async () => {
			vi.mocked(run_review_pinned_tree.key).mockResolvedValue(FIXED_TREE)

			return test_pinned_record.not_run_summary('timeout')
		})
		const joined = await run_review_join_read.read(ROOT, true)

		expect(joined).toMatchObject({ is_stop: false, summary: { unpinned: [], is_unchecked: true } })
		expect(joined?.text).toContain(MOVED_TEXT)
		expect(joined?.text).not.toContain(FIRST)
	})
})

describe('run_review_pinned_remaining failed reads use only current cache', () => {
	it.each([
		{ kind: 'missing', result: { ...CACHED, unpinned: [] } },
		{ kind: 'stale', result: { ...CACHED, is_stale: true } },
		{ kind: 'unreadable', result: new Error('cache unavailable') },
	])('keeps a $kind cache unchecked without inventing places', async ({ result }) => {
		await prepare_failure('timeout')
		prepare_lane_read()

		if (result instanceof Error) {
			vi.mocked(test_pinned.cached).mockRejectedValue(result)
		} else {
			vi.mocked(test_pinned.cached).mockResolvedValue(result)
		}

		expect(await run_review_join_read.read_finished(ROOT)).toMatchObject({
			summary: { unpinned: [], is_unchecked: true, text: expect.stringContaining('timeout') },
		})
	})

	it('discards cached places when the tree moves while reading the cache', async () => {
		await prepare_failure(LOST)
		prepare_lane_read()
		vi.mocked(test_pinned.cached).mockImplementation(async () => {
			vi.mocked(run_review_pinned_tree.key).mockResolvedValue(FIXED_TREE)

			return CACHED
		})

		expect(await run_review_join_read.read_finished(ROOT)).toMatchObject({
			is_stop: false,
			summary: { unpinned: [], is_unchecked: true },
		})
	})
})

describe('run_review_pinned_remaining lane collection', () => {
	it('allows a lane child to collect remaining places through the existing pinned command', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		vi.spyOn(run_review_pinned_steps, 'is_remaining').mockReturnValue(true)
		vi.spyOn(run_review_pinned_remaining, 'read').mockResolvedValue(WHOLE)
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_steps, 'wait_for_gate_finish')

		expect(await run_review_cli.run(['--pinned'])).toBe(3)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(LATER))
		expect(run_review_steps.wait_for_gate_finish).not.toHaveBeenCalled()
	})

	it('reports an unreadable tree without claiming a successful launch', async () => {
		vi.mocked(run_review_pinned_tree.key).mockResolvedValue(undefined)

		expect(await run_review_pinned_remaining.start(ROOT)).toMatchObject({ kind: 'failed' })
		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})
})
