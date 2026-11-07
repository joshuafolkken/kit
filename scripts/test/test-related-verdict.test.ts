import { rmSync } from 'node:fs'
import path from 'node:path'
import { gate_tree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { tree_verdict } from '#scripts/gate/tree-verdict'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_verdict } from './test-related-verdict'
import { test_unit_guard } from './test-unit-guard'

const make_directory = temporary_directory('suite')
const SCRATCH = make_directory('test-related-verdict-')
const SOURCE = 'source.ts'
const TREE = { files: { [SOURCE]: 'digest' }, base: 'base' }
const OTHER = 'other.ts'
const FAILED = 1
const TEST = 'source.test.ts'
const BLOBS = { [TEST]: 'test-digest' }
const fresh = vi.fn(async () => 0)

beforeEach(() => {
	vi.spyOn(tree_verdict, 'record_path').mockImplementation((name) => path.join(SCRATCH, name))
	vi.spyOn(scoped_green, 'read_before').mockResolvedValue(TREE)
	vi.spyOn(review_stamps.test_related_stamp, 'write').mockReturnValue('unused')
	vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue(undefined)
	vi.spyOn(review_stamps.test_related_stamp, 'describes_inputs').mockReturnValue(true)
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(TREE)
	vi.spyOn(test_unit_guard, 'is_running').mockReturnValue(true)
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(lane_ledger_write, 'record_ship_lap').mockResolvedValue(undefined)
	fresh.mockClear().mockResolvedValue(0)
})

afterEach(() => {
	rmSync(SCRATCH, { recursive: true, force: true })
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('test_related_verdict.run', () => {
	it.each([[], [SOURCE], [SOURCE, '--silent']])(
		'replays the same green arguments %j without starting tests',
		async (...given) => {
			await test_related_verdict.run(given, fresh)
			expect(await test_related_verdict.run(given, fresh)).toBe(0)
			expect(fresh).toHaveBeenCalledTimes(1)
			expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('reused: tree'))
		},
	)

	it.each([
		{ ...TREE, files: { [SOURCE]: 'moved' } },
		{ ...TREE, base: 'moved' },
		{ ...TREE, base: undefined },
	])('runs again when the tree or base changes: %j', async (changed) => {
		await test_related_verdict.run([], fresh)
		vi.mocked(scoped_green.read_before).mockResolvedValue(changed)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
	})

	it('runs again when verification inputs change', async () => {
		vi.stubEnv('TZ', 'UTC')
		await test_related_verdict.run([], fresh)
		vi.stubEnv('TZ', 'Asia/Tokyo')
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
	})
})

describe('test_related_verdict.run — individual stamp greens', () => {
	it.each([
		{ tree: TREE, inputs_match: true, expected: BLOBS },
		{ tree: { ...TREE, files: { [SOURCE]: 'moved' } }, inputs_match: true, expected: undefined },
		{ tree: { ...TREE, base: 'moved' }, inputs_match: true, expected: undefined },
		{ tree: TREE, inputs_match: false, expected: undefined },
	])('preserves individual greens only for a matching stamp: %j', async (sample) => {
		await test_related_verdict.run([], fresh)
		vi.mocked(review_stamps.test_related_stamp.read).mockReturnValue({
			...sample.tree,
			taken_at: 'now',
			blobs: BLOBS,
		})
		vi.mocked(review_stamps.test_related_stamp.describes_inputs).mockReturnValue(
			sample.inputs_match,
		)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(1)
		expect(review_stamps.test_related_stamp.write).toHaveBeenCalledWith(
			TREE.files,
			undefined,
			TREE.base,
			sample.expected,
		)
	})
})

describe('test_related_verdict.run — scoped stamp refresh', () => {
	it('refreshes the bare scoped stamp when returning to a cached tree', async () => {
		await test_related_verdict.run([], fresh)
		const moved = { ...TREE, files: { [SOURCE]: 'moved' } }

		vi.mocked(scoped_green.read_before).mockResolvedValue(moved)
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(moved)
		await test_related_verdict.run(['--keep-whole-suite'], fresh)
		vi.mocked(scoped_green.read_before).mockResolvedValue(TREE)
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
		expect(review_stamps.test_related_stamp.write).toHaveBeenCalledWith(
			TREE.files,
			undefined,
			TREE.base,
			undefined,
		)
	})

	it('never refreshes the full scoped stamp for explicit replay arguments', async () => {
		await test_related_verdict.run([SOURCE], fresh)
		await test_related_verdict.run([SOURCE], fresh)
		expect(review_stamps.test_related_stamp.write).not.toHaveBeenCalled()
	})
})

describe('test_related_verdict.run — touched review record', () => {
	it('records fresh and replayed touched greens separately from the full reach', async () => {
		await test_related_verdict.run(['--touched'], fresh)
		await test_related_verdict.run(['--touched'], fresh)
		expect(fresh).toHaveBeenCalledTimes(1)
		expect(review_stamps.test_related_stamp.write).toHaveBeenCalledTimes(2)
		expect(review_stamps.test_related_stamp.write).toHaveBeenCalledWith(
			TREE.files,
			test_related_verdict.touched_target(),
			TREE.base,
			undefined,
		)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
	})

	it.each([
		['--touched', SOURCE],
		['--touched', '--silent'],
	])('never records narrowed touched arguments %j for review', async (...given) => {
		await test_related_verdict.run(given, fresh)
		await test_related_verdict.run(given, fresh)
		expect(review_stamps.test_related_stamp.write).not.toHaveBeenCalled()
	})

	it('does not record a failed touched run or one whose tree moved', async () => {
		fresh.mockResolvedValue(FAILED)
		await test_related_verdict.run(['--touched'], fresh)
		fresh.mockResolvedValue(0)
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, base: 'moved' })
		await test_related_verdict.run(['--touched'], fresh)
		expect(review_stamps.test_related_stamp.write).not.toHaveBeenCalled()
	})
})

describe('test_related_verdict.run — scope isolation', () => {
	it('does not let explicit files or flags answer another scope', async () => {
		await test_related_verdict.run([SOURCE], fresh)
		await test_related_verdict.run([OTHER], fresh)
		await test_related_verdict.run([SOURCE, '--silent'], fresh)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(4)
	})

	it('runs a failure again and never replays it as green', async () => {
		fresh.mockResolvedValue(FAILED)
		expect(await test_related_verdict.run([], fresh)).toBe(FAILED)
		expect(await test_related_verdict.run([], fresh)).toBe(FAILED)
		expect(fresh).toHaveBeenCalledTimes(2)
	})

	it('keeps no verdict when the tree moves during tests', async () => {
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, base: 'moved' })
		await test_related_verdict.run([], fresh)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
	})

	it('keeps no verdict for a skipped unit runner', async () => {
		vi.mocked(test_unit_guard.is_running).mockReturnValue(false)
		await test_related_verdict.run([], fresh)
		vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
		await test_related_verdict.run([], fresh)
		expect(fresh).toHaveBeenCalledTimes(2)
	})
})

describe('test_related_verdict.run — ship telemetry', () => {
	it('records an explicit replay in the inherited ship lap', async () => {
		await test_related_verdict.run([SOURCE], fresh)
		await run_ship_lap.within(
			'6249',
			'sync',
			async () => await test_related_verdict.run([SOURCE], fresh),
			'josh git',
		)
		expect(lane_ledger_write.record_ship_lap).toHaveBeenCalledWith(
			expect.objectContaining({ step: 'josh git › test:related', is_reused: true }),
		)
	})
})

function plant_lint_green(): void {
	vi.spyOn(review_stamps.lint_related_stamp, 'read').mockReturnValue({ ...TREE, taken_at: 'now' })
	vi.spyOn(review_stamps.lint_related_stamp, 'describes_inputs').mockReturnValue(true)
}

describe('test_related_verdict.run — review prerequisites', () => {
	it('admits a review-fix check without satisfying full-reach checks', async () => {
		let touched: FileMapStamp | undefined

		vi.mocked(review_stamps.test_related_stamp.write).mockImplementation((files, target, base) => {
			if (target === test_related_verdict.touched_target()) {
				touched = { files, taken_at: 'now', ...(base !== undefined && { base }) }
			}

			return 'unused'
		})
		vi.mocked(review_stamps.test_related_stamp.read).mockImplementation((target) =>
			target === test_related_verdict.touched_target() ? touched : undefined,
		)
		plant_lint_green()
		const sources = { test: test_related_verdict.touched_target() }

		expect(scoped_green.refusal_for(TREE.files, TREE.base, sources)).toBeDefined()
		await test_related_verdict.run(['--touched'], fresh)
		expect(scoped_green.refusal_for(TREE.files, TREE.base, sources)).toBeUndefined()
		expect(scoped_green.refusal_for(TREE.files, TREE.base)).toBeDefined()
		expect(scoped_green.refusal_for({ [SOURCE]: 'moved' }, TREE.base, sources)).toBeDefined()
	})
})
