import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { test_related_cap } from '#scripts/test/test-related-cap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_plan_signals } from './lane-plan-signals'

// joshuafolkken/kit#5568: what `lane:plan` measures beside the plan — the tree's hunks, tests excluded,
// the period's lines ratio, and whether the lane filed a split child.

const ISSUE = 5568
const NOW = Date.parse('2026-10-31T12:00:00.000Z')
const RECENT = '2026-10-31T10:00:00.000Z'
const MERGED = '2026-10-31T11:00:00.000Z'

function file_diff(file: string, starts: ReadonlyArray<number>): Array<string> {
	const hunks = starts.flatMap((start) => [
		`@@ -${String(start)} +${String(start)} @@`,
		'-old',
		'+new',
	])

	return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...hunks]
}

const SOURCE = 'scripts/lane/one.ts'
const DIFF = [...file_diff(SOURCE, [1, 9]), ...file_diff('scripts/lane/one.test.ts', [1])].join(
	'\n',
)

function sized(issue: number, declared_lines: number, actual_lines: number): Array<LedgerEntry> {
	return [
		{
			kind: 'size',
			at: RECENT,
			issue,
			declared: { files: 4, lines: declared_lines },
			actual: { files: 4, lines: actual_lines },
		},
		{ kind: 'merge', at: MERGED, issue },
	]
}

describe('lane_plan_signals.hunk_files', () => {
	it('names the file of each hunk a declaration counts, not of the tests', () => {
		expect(lane_plan_signals.hunk_files(DIFF)).toStrictEqual([SOURCE, SOURCE])
	})

	it('names none on an empty diff', () => {
		expect(lane_plan_signals.hunk_files('')).toStrictEqual([])
	})
})

describe('lane_plan_signals measured rate', () => {
	it('measures implementation and declaration growth from the same ledger window (ac-881063cd)', () => {
		const entries: Array<LedgerEntry> = [
			{ kind: 'dispatch', at: RECENT, issue: 1 },
			{
				kind: 'stage',
				at: '2026-10-31T10:30:00.000Z',
				issue: 1,
				stage: 'preflight',
				elapsed_ms: 0,
			},
			...sized(1, 50, 100),
			{ kind: 'dispatch', at: '2026-10-27T10:00:00.000Z', issue: 2 },
			{
				kind: 'stage',
				at: '2026-10-27T11:00:00.000Z',
				issue: 2,
				stage: 'preflight',
				elapsed_ms: 0,
			},
			...sized(2, 10, 100).map((entry) => ({ ...entry, at: '2026-10-27T11:30:00.000Z' })),
		]
		const tree = { hunk_files: [], committed_files: [] }

		expect(lane_plan_signals.signals_from(ISSUE, tree, entries, NOW)).toMatchObject({
			files_ratio: 1,
			lines_ratio: 2,
			implement_rate: { median: 30, lanes: 1 },
		})
	})
})

describe('lane_plan_signals.signals_from', () => {
	it('reads the period lines ratio and no split child off a ledger of merged sizes', () => {
		const entries = [...sized(1, 100, 150), ...sized(2, 100, 250)]

		const tree = { hunk_files: ['a.ts'], committed_files: ['b.ts'] }

		expect(lane_plan_signals.signals_from(ISSUE, tree, entries, NOW)).toStrictEqual({
			hunk_files: ['a.ts'],
			committed_files: ['b.ts'],
			files_ratio: 1,
			lines_ratio: 2,
			implement_rate: undefined,
			split_filed: false,
		})
	})

	it('answers no ratio on an empty ledger, and a split child the lane filed', () => {
		const filed: LedgerEntry = { kind: 'split-filed', at: RECENT, issue: ISSUE, child: '#9' }

		const tree = { hunk_files: [], committed_files: [] }

		expect(lane_plan_signals.signals_from(ISSUE, tree, [filed], NOW)).toStrictEqual({
			hunk_files: [],
			committed_files: [],
			files_ratio: undefined,
			lines_ratio: undefined,
			implement_rate: undefined,
			split_filed: true,
		})
	})
})

// joshuafolkken/kit#6652: the change base's file listing, so `lane:plan` can tell a new file from an existing one.
const BASE = 'base-sha'
const HUB = 'scripts/split/split-assess.ts'

async function listing(arguments_: ReadonlyArray<string>): Promise<string> {
	return await (arguments_[0] === 'ls-tree' ? 'a.ts\nscripts/b.ts\n' : '')
}

describe('lane_plan_signals.signals_of base_files', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('lists the files the change base holds (ac-36d58f44)', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(BASE)
		const read = vi.spyOn(git_spawn, 'read').mockImplementation(listing)

		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)

		const signals = await lane_plan_signals.signals_of(ISSUE)

		expect(signals.base_files).toStrictEqual(new Set(['a.ts', 'scripts/b.ts']))
		expect(read).toHaveBeenCalledWith(['ls-tree', '-r', '--name-only', BASE])
	})

	it('answers no listing when the change base does not resolve (ac-98beb1b4)', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(undefined)
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)

		const signals = await lane_plan_signals.signals_of(ISSUE)

		expect(signals.base_files).toBeUndefined()
	})

	it('answers no listing, not an empty one, when the listing cannot be read', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(BASE)
		vi.spyOn(git_spawn, 'read').mockRejectedValue(new Error('ls-tree failed'))
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)

		const signals = await lane_plan_signals.signals_of(ISSUE)

		expect(signals.base_files).toBeUndefined()
	})
})

describe('lane_plan_signals.signals_of hubs', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads the hubs among the planned files, and none for no plan (joshuafolkken/kit#6543)', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(undefined)
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)
		const hubs_of = vi.spyOn(test_related_cap, 'hubs_of').mockResolvedValue([HUB])

		const planned = await lane_plan_signals.signals_of(ISSUE, [HUB, SOURCE])
		const unplanned = await lane_plan_signals.signals_of(ISSUE)

		expect(planned.hubs).toStrictEqual([HUB])
		expect(hubs_of).toHaveBeenCalledWith(process.cwd(), [HUB, SOURCE])
		expect(unplanned.hubs).toStrictEqual([])
		expect(hubs_of).toHaveBeenCalledOnce()
	})
})
