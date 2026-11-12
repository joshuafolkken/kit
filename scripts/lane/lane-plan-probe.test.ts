import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'
import { lane_plan_probe } from './lane-plan-probe'
import { lane_plan_signals } from './lane-plan-signals'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6142: `run:review`'s open widens a plan through `extend`, which neither waits nor
// yields — a clear check records the widened plan, a clash or an unread listing writes nothing.

const ROOT = make_directory('lane-plan-probe-')
const directory = path.join(ROOT, 'lane')
const HOLDER = 6036
const LANE = 6035
const PLANNED = 'scripts/lane/planned.ts'
const HELD = 'scripts/lane/held.ts'
const FREE_FILE = 'scripts/lane/free.ts'
const LISTING_LIMIT = 100
const LANE_PLAN = { issue: LANE, paths: [PLANNED], planned_at: '2026-11-02T00:00:00.000Z' }

const EXTRA_FILE = 'scripts/lane/extra.ts'
const DECLARED = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 20 行（テスト除く）\n'
const QUIET = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')

const signals_of = vi.spyOn(lane_plan_signals, 'signals_of').mockResolvedValue(QUIET)

function running(number: number, body = ''): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return { number, title: 'running', createdAt: '2026-11-01T00:00:00Z', labels, body }
}

function listing(lane_body = ''): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const issues = [running(HOLDER), running(LANE, lane_body)]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

beforeEach(() => {
	fetch_opted_in.mockResolvedValue(listing())
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [HELD], planned_at: '2026-11-01T00:00:00.000Z' },
		directory,
	)
	lane_plan.record(LANE_PLAN, directory)
})

describe('lane_plan_probe.extend', () => {
	it('records the widened plan cleared when no running lane holds its files', async () => {
		const widened = { ...LANE_PLAN, paths: [PLANNED, FREE_FILE] }

		expect(await lane_plan_probe.extend(widened, directory)).toBeUndefined()
		expect(lane_plan.read(LANE, directory)).toMatchObject({
			paths: [PLANNED, FREE_FILE],
			cleared: true,
		})
	})

	it('returns the clash and records nothing when a running lane holds a file', async () => {
		const found = await lane_plan_probe.extend({ ...LANE_PLAN, paths: [PLANNED, HELD] }, directory)

		expect(found).toMatchObject({ holder: HOLDER, path: HELD })
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})

	it('answers unread and records nothing when the listing cannot be read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		const found = await lane_plan_probe.extend(
			{ ...LANE_PLAN, paths: [PLANNED, FREE_FILE] },
			directory,
		)

		expect(lane_plan_probe.is_unread(found)).toBe(true)
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})

	it('answers oversize and records nothing when the widening outgrows the declared size', async () => {
		fetch_opted_in.mockResolvedValue(listing(DECLARED))

		const found = await lane_plan_probe.extend(
			{ ...LANE_PLAN, paths: [PLANNED, FREE_FILE, EXTRA_FILE] },
			directory,
		)

		expect(lane_plan_probe.is_oversize(found)).toBe(true)
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})
})

describe('lane_plan_probe.extend size signals', () => {
	it('reads the size signals off the widened paths, so a planned hub splits (joshuafolkken/kit#6543)', async () => {
		fetch_opted_in.mockResolvedValue(listing(DECLARED))
		const paths = [PLANNED, FREE_FILE]

		await lane_plan_probe.extend({ ...LANE_PLAN, paths }, directory)

		expect(signals_of).toHaveBeenCalledWith(LANE, paths)
	})
})
