import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { line_budget } from '#scripts/lines/line-budget'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_probe } from './lane-plan-probe'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_plan_wait } from './lane-plan-wait'
import { lane_yield } from './lane-yield'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6647: joshuafolkken/kit#6558 was one deliverable declared at 1 file whose least
// change touched 5, and the files axis split it into a child that would take every acceptance criterion.
// `--single` records such a plan and notes the overrun for the pre-gate `run:cut`; a plan without it, or
// one past the hunks axis, still answers `split`.

const ROOT = make_directory('lane-plan-single-')
const ISSUE = 6558
const SUCCESS = 0
const LISTING_LIMIT = 100
const SINGLE = '--single'
const PROBE = '--probe'
const DECLARED = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 20 行（テスト除く）\n'
const GROWN = ['scripts/lane/one.ts', 'scripts/lane/two.ts', 'scripts/lane/three.ts']
const PLAN = [String(ISSUE), ...GROWN]
const QUIET = lane_plan_signals.signals_from(ISSUE, { hunk_files: [], committed_files: [] }, [], 0)
const PROBED = 'scripts/lane/probed.ts'
const FILES_WARNING = 'size warning (files)'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')
const signals_of = vi.spyOn(lane_plan_signals, 'signals_of')
const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')

const directory = path.join(ROOT, 'lane')

function listing(): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]
	const issues: Array<OpenIssueData> = [
		{ number: ISSUE, title: 'one', createdAt: '2026-11-07T00:00:00Z', labels, body: DECLARED },
	]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

function last_error(): string {
	return String(error.mock.calls.at(-1)?.[0])
}

beforeEach(() => {
	vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
	vi.spyOn(lane_yield, 'record_yield').mockResolvedValue(undefined)
	vi.spyOn(run_hold_cli, 'run').mockResolvedValue(SUCCESS)
	vi.spyOn(lane_plan_wait, 'deadline').mockResolvedValue(undefined)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
	fetch_opted_in.mockResolvedValue(listing())
	signals_of.mockResolvedValue(QUIET)
	record_split_notice.mockResolvedValue(undefined)
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
})

describe('lane:plan --single on the files axis', () => {
	it('records one deliverable past its declared files and notes the overrun for the pre-gate cut', async () => {
		expect(await lane_plan_cli.run([...PLAN, SINGLE], directory)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(lane_plan.read(ISSUE, directory)).toMatchObject({ paths: GROWN, single: true })
		expect(record_split_notice).toHaveBeenCalledWith({
			issue: ISSUE,
			files: GROWN.length,
			lines: 0,
			reason: 'files',
		})
		expect(error).toHaveBeenCalledWith(expect.stringContaining(FILES_WARNING))
	})

	it('answers `clear` to `--probe --single`, noting and recording nothing', async () => {
		expect(await lane_plan_cli.run([...PLAN, SINGLE, PROBE], directory)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(record_split_notice).not.toHaveBeenCalled()
		expect(lane_plan.read(ISSUE, directory)).toBeUndefined()
	})

	it('reads `--single` ahead of the issue number as the flag, not the issue', async () => {
		expect(await lane_plan_cli.run([SINGLE, ...PLAN], directory)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, directory)).toMatchObject({ paths: GROWN, single: true })
	})

	it('keeps a recorded `--single` on a re-plan that omits the flag', async () => {
		await lane_plan_cli.run([...PLAN, SINGLE], directory)

		expect(await lane_plan_cli.run(PLAN, directory)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, directory)?.single).toBe(true)
	})
})

describe('lane:plan size bar without a waiver', () => {
	it('answers `split` without `--single`, pointing to it, and records no plan', async () => {
		expect(await lane_plan_cli.run(PLAN, directory)).toBe(lane_plan_check.SPLIT_EXIT_CODE)
		expect(info).toHaveBeenCalledWith('split')
		expect(last_error()).toContain('split (files)')
		expect(last_error()).toContain(SINGLE)
		expect(lane_plan.read(ISSUE, directory)).toBeUndefined()
	})

	it('answers `split (hunks)` to a first plan without `--single` whose probed hunks outgrow it', async () => {
		signals_of.mockResolvedValue({ ...QUIET, hunk_files: [PROBED, PROBED, PROBED] })

		expect(await lane_plan_cli.run([String(ISSUE), GROWN[0] ?? ''], directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(last_error()).toContain('split (hunks)')
		expect(lane_plan.read(ISSUE, directory)).toBeUndefined()
	})
})

// joshuafolkken/kit#6602: past the first registration, or for one deliverable, size alone only warns.
describe('lane:plan size warning', () => {
	it('records a `--single` plan whose probed hunks outgrow it, with a size warning', async () => {
		signals_of.mockResolvedValue({ ...QUIET, hunk_files: [PROBED, PROBED, PROBED] })

		expect(await lane_plan_cli.run([...PLAN, SINGLE], directory)).toBe(SUCCESS)
		expect(last_error()).toContain('size warning (hunks)')
		expect(lane_plan.read(ISSUE, directory)).toMatchObject({ paths: GROWN, single: true })
	})

	it('records a re-plan of a sized plan past the files bar, with a size warning', async () => {
		await lane_plan_cli.run([String(ISSUE), GROWN[0] ?? ''], directory)

		expect(await lane_plan_cli.run(PLAN, directory)).toBe(SUCCESS)
		expect(last_error()).toContain(FILES_WARNING)
		expect(lane_plan.read(ISSUE, directory)).toMatchObject({ paths: GROWN, sized: true })
	})

	it('names `--single` in the usage', () => {
		expect(lane_plan_cli.USAGE).toContain(`[${SINGLE}]`)
	})
})

// `run:review`'s open widens a recorded plan by one unplanned file; it must agree with `lane:plan`'s answer.
describe('lane_plan_probe.extend on a widened plan', () => {
	const WIDENED = { issue: ISSUE, paths: [...GROWN, PROBED], planned_at: '2026-11-08T00:00:00Z' }

	it('records a `--single` plan whose only overrun is the waived files axis', async () => {
		expect(await lane_plan_probe.extend({ ...WIDENED, single: true }, directory)).toBeUndefined()
		expect(lane_plan.read(ISSUE, directory)).toMatchObject({ paths: WIDENED.paths, single: true })
	})

	it('answers `oversize` to the same widening without `--single`, recording nothing', async () => {
		expect(lane_plan_probe.is_oversize(await lane_plan_probe.extend(WIDENED, directory))).toBe(true)
		expect(lane_plan.read(ISSUE, directory)).toBeUndefined()
	})
})
