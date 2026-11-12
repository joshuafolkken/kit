import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_why_cli } from './lane-why-cli'

// joshuafolkken/kit#6120: `josh lane:why <issue>` prints the stages over budget from the records, and an
// unreadable Issue, rate or listing blanks its cells instead of failing the command.

const mocks = vi.hoisted(() => ({
	read_records: vi.fn(),
	measurements: vi.fn(),
	issue_get_body: vi.fn<() => Promise<string | undefined>>(),
	read_issues: vi.fn(),
	timing_of: vi.fn(),
	repository_directory: vi.fn<() => Promise<string | undefined>>(),
	read_log: vi.fn<() => string | undefined>(),
}))

vi.mock(import('./lane-net-read'), async (import_original) => {
	const { lane_net_read } = await import_original()

	return {
		lane_net_read: {
			...lane_net_read,
			read_records: mocks.read_records,
			measurements: mocks.measurements,
		},
	}
})
vi.mock(import('./lane-transcript-stats'), async (import_original) => {
	const { lane_transcript_stats } = await import_original()

	return { lane_transcript_stats: { ...lane_transcript_stats, read_calls: () => [] } }
})
vi.mock(import('#scripts/gh/git-gh-issue-read'), async (import_original) => {
	const { git_gh_issue_read } = await import_original()

	return { git_gh_issue_read: { ...git_gh_issue_read, issue_get_body: mocks.issue_get_body } }
})
vi.mock(import('./lane-sinks-issues'), async (import_original) => {
	const { lane_sinks_issues } = await import_original()

	return { lane_sinks_issues: { ...lane_sinks_issues, read: mocks.read_issues } }
})
vi.mock(import('#scripts/run/ship/run-ship-probe'), async (import_original) => {
	const { run_ship_probe } = await import_original()

	return { run_ship_probe: { ...run_ship_probe, repository_directory: mocks.repository_directory } }
})
vi.mock(import('#scripts/run/ship/run-ship-detach'), async (import_original) => {
	const { run_ship_detach } = await import_original()

	return { run_ship_detach: { ...run_ship_detach, read_log: mocks.read_log } }
})
vi.mock(import('#scripts/ci/ci-timing'), async (import_original) => {
	const { ci_timing } = await import_original()

	return { ci_timing: { ...ci_timing, timing_of: mocks.timing_of } }
})

const ISSUE = 6050
const FAILURE = 1
const START = Date.parse('2026-11-03T05:00:00.000Z')
const MINUTE_MS = 60_000

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function lane(merge_minute: number): ReadonlyArray<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(merge_minute), issue: ISSUE },
	]
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	mocks.read_records.mockResolvedValue({
		entries: lane(61),
		events: [{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` }],
	})
	mocks.measurements.mockResolvedValue({ implement_rate: undefined, growth: {} })
	mocks.issue_get_body.mockResolvedValue(undefined)
	mocks.read_issues.mockResolvedValue(undefined)
	mocks.timing_of.mockRejectedValue(new Error('gh failed'))
	mocks.repository_directory.mockResolvedValue(undefined)
	mocks.read_log.mockReturnValue(undefined)
})

describe('lane_why_cli.run', () => {
	it('projects declared lines with the measured growth', async () => {
		mocks.issue_get_body.mockResolvedValue(
			'## 背景\n\n- 規模見積もり: 約 1 ファイル / 100 行（テスト除く）',
		)
		mocks.measurements.mockResolvedValue({
			implement_rate: { median: 10, lanes: 1 },
			growth: { files: 3, lines: 1.5 },
		})

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('| 15.0 min |'))
	})
})

// joshuafolkken/kit#6679: the ship log is where the ship's cause keys come from.
describe('lane_why_cli.run ship log', () => {
	it("reads the lane's ship log from the repository directory", async () => {
		mocks.repository_directory.mockResolvedValue('/repo')

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(mocks.read_log).toHaveBeenCalledWith('/repo', String(ISSUE))
	})

	it("prints the failed check the ship log names as a ship row's cause key", async () => {
		mocks.read_records.mockResolvedValue({
			entries: lane(61),
			events: [
				{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` },
				{ pos: 2, at: at(20), kind: 'ship-stage', text: `#${String(ISSUE)} review start` },
			],
		})
		mocks.repository_directory.mockResolvedValue('/repo')
		mocks.read_log.mockReturnValue('PR checks failed (failed checks: Static Checks (lint)).')

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('| static checks (lint) | unread | unread |'),
		)
	})
})

describe('lane_why_cli.run output', () => {
	it('prints the table with blank cells when the Issue, rate and listing are unreadable', async () => {
		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('| implement | 51.0 min | 9 min |  |  |  |  |'),
		)
	})

	it('reads the lane branch CI timing and still prints the table when ci:timing throws', async () => {
		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(mocks.timing_of).toHaveBeenCalledWith(`${String(ISSUE)}-lane`)
	})

	it('prints one line when no stage ran over its budget', async () => {
		mocks.read_records.mockResolvedValue({ entries: lane(1), events: [] })

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('ran over its budget'))
	})

	it('prints the ship total even when no stage ran over its budget', async () => {
		mocks.read_records.mockResolvedValue({ entries: lane(1), events: [] })

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('| ship total |'))
	})

	it('refuses a lane the ledger holds no dispatch and merge of', async () => {
		mocks.read_records.mockResolvedValue({ entries: [], events: [] })

		await expect(lane_why_cli.run([String(ISSUE)])).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no dispatch and merge'))
	})

	it('prints the usage for a malformed argument', async () => {
		await expect(lane_why_cli.run(['x'])).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_why_cli.USAGE)
	})
})
