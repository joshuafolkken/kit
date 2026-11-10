import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'
import { lane_over } from './lane-over'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5988: the #5953 lane of 2026-11-03 — four split notices, the #5958 split child,
// a blocking round 1, a yield to #5943 dispatched again after #5943 merged, and the
// `run-step-section.ts` hub past the `test:related` cap.

const YIELDER = 5953
const HOLDER = 5943
const SHORT = 5960
const URL = 'https://github.com/joshuafolkken/kit/issues'
const HUB = 'scripts/run/run-step-section.ts'
const CHILD = '#5958'
const SPLIT_FILED = 'split-filed'
const WINDOW = {
	since_ms: Date.parse('2026-11-03T00:00:00.000Z'),
	until_ms: Date.parse('2026-11-04T00:00:00.000Z'),
}

const scratch = make_directory('lane-over-test-')

function at(clock: string): string {
	return `2026-11-03T${clock}:00.000Z`
}

function cited(issue: number): string {
	return `[#${String(issue)}](${URL}/${String(issue)})`
}

function split_notice(clock: string): LedgerEntry {
	return { kind: 'split-notice', at: at(clock), issue: YIELDER, files: 9, lines: 240 }
}

const ENTRIES: ReadonlyArray<LedgerEntry> = [
	{ kind: 'dispatch', at: at('17:00'), issue: YIELDER },
	...['17:10', '17:20', '17:30', '17:40'].map((clock) => split_notice(clock)),
	{ kind: SPLIT_FILED, at: at('17:45'), issue: YIELDER, child: CHILD },
	{ kind: 'merge', at: at('18:19'), issue: HOLDER },
	{ kind: 'dispatch', at: at('18:33'), issue: YIELDER },
	{ kind: 'round-one', at: at('19:00'), issue: YIELDER, verdict: 'blocking' },
	{
		kind: 'test-related',
		at: at('19:10'),
		issue: YIELDER,
		scope: 'related',
		changed: 3,
		synced: 0,
		since_map: 0,
		readers: 1,
		over_cap: 2,
		over_cap_hub: HUB,
		elapsed_ms: 1000,
	},
	{ kind: 'merge', at: at('19:30'), issue: YIELDER },
	{ kind: 'dispatch', at: at('20:00'), issue: SHORT },
	{ kind: 'merge', at: at('20:10'), issue: SHORT },
]

const EVENTS: ReadonlyArray<RunEvent> = [
	{
		pos: 0,
		at: at('17:56'),
		kind: 'note',
		text: `#${String(YIELDER)} yielded its lane: ${cited(YIELDER)}'s planned \`a.ts\` overlaps \`a.ts\`, which ${cited(HOLDER)} declares or plans · at: summary`,
	},
	{ pos: 1, at: at('18:31'), kind: 'setup', text: `opening lane #${String(YIELDER)}` },
]

const RECORDS = { entries: ENTRIES, events: EVENTS }

describe('lane_over.chain_of', () => {
	it('names the whole #5953 chain in one cell', () => {
		expect(lane_over.chain_of(RECORDS, YIELDER)).toBe(
			[
				'split-notice ×4',
				`${SPLIT_FILED} ${CHILD}`,
				'round 1 blocking',
				`yield → ${session_cite.issue(HOLDER)} gap 14 min`,
				`hub over cap ${HUB}`,
			].join(' · '),
		)
	})

	it('prints a dash for a lane the ledger explains nothing of', () => {
		expect(lane_over.chain_of(RECORDS, SHORT)).toBe('-')
	})
})

function yield_records(holder?: number): { entries: Array<LedgerEntry>; events: Array<RunEvent> } {
	const which = holder === undefined ? '' : `, which ${cited(holder)} declares or plans`
	const text = `#${String(YIELDER)} yielded its lane: ${cited(YIELDER)}'s planned \`a.ts\` overlaps \`a.ts\`${which} · at: summary`

	return {
		entries: [
			{ kind: 'dispatch', at: at('17:00'), issue: YIELDER },
			{ kind: 'dispatch', at: at('18:33'), issue: YIELDER },
		],
		events: [{ pos: 0, at: at('17:56'), kind: 'note', text }],
	}
}

describe('lane_over.chain_of — a yield the holder end does not split', () => {
	it('names a redispatch before the still-running holder ended', () => {
		expect(lane_over.chain_of(yield_records(HOLDER), YIELDER)).toBe(
			`yield → ${session_cite.issue(HOLDER)} dispatched before holder end`,
		)
	})

	it('prints a yield naming no holder with its gap open', () => {
		expect(lane_over.chain_of(yield_records(), YIELDER)).toBe('yield gap open')
	})
})

describe('lane_over.table', () => {
	it('prints one row for #5953 alone, past the 40-minute threshold', () => {
		const rows = lane_over.table(RECORDS, WINDOW, 40, []).split('\n')

		expect(rows).toHaveLength(3)
		expect(rows[2]).toMatch(/\| 37\.0 \| split-notice ×4 · .*run-step-section\.ts \|/u)
		expect(rows[2]?.startsWith(`| ${session_cite.issue(YIELDER)} | `)).toBe(true)
	})

	it('reads the open issues unread when the listing failed', () => {
		const row = lane_over.table(RECORDS, WINDOW, 40, undefined).split('\n').at(-1)

		expect(row).toMatch(/\| unread \|$/u)
	})
})

function seeded_context(): { ledger_path: string; events_path: string; now_ms: number } {
	const context = {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
		now_ms: WINDOW.until_ms,
	}

	for (const entry of ENTRIES) lane_ledger_write.append(context.ledger_path, entry)

	for (const event of EVENTS) run_event_stream.append_event(context.events_path, event)

	return context
}

describe('lane_measure_cli.run — stats --over', () => {
	it('names --over in the usage', () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:stats --period <days> --over <minutes>')
	})

	it('prints the over-time lane rows', async () => {
		vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await expect(
			lane_measure_cli.run(['stats', '--period', '1', '--over', '40'], seeded_context()),
		).resolves.toBe(0)
		expect(String(info.mock.calls[0]?.[0])).toContain(SPLIT_FILED)
	})

	// joshuafolkken/kit#6985: the lane rows are followed by the causes they share.
	it('prints the shared causes and their filing candidates after the lane rows', async () => {
		vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await lane_measure_cli.run(['stats', '--period', '1', '--over', '40'], seeded_context())
		expect(String(info.mock.calls[0]?.[0])).toContain(`| hub | ${HUB} | 1 |`)
		expect(String(info.mock.calls[0]?.[0])).toContain(`filing candidates: hub ${HUB}`)
	})
})

describe('lane_measure_cli.run — issue linking and causes', () => {
	it('reads and links open issues in the over-time lane rows', async () => {
		vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({
			json: JSON.stringify([{ number: 6474, title: 'Speed up start to plan and implement' }]),
			is_capped: false,
		})
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await lane_measure_cli.run(['stats', '--period', '1', '--over', '40'], seeded_context())
		expect(String(info.mock.calls[0]?.[0])).toContain(cited(6474))
		expect(String(info.mock.calls[0]?.[0])).not.toContain('unread')
	})

	it('prints period-wide causes with one issue listing', async () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:stats --period <days> --why <minutes>')
		const listing = vi
			.spyOn(git_gh_issue_list, 'issue_list')
			.mockResolvedValue({ json: '[]', is_capped: false })
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await expect(
			lane_measure_cli.run(['stats', '--period', '1', '--why', '40'], seeded_context()),
		).resolves.toBe(0)
		expect(String(info.mock.calls[0]?.[0])).toContain(
			'| cause | lanes | total net min | open issues |',
		)
		expect(String(info.mock.calls[0]?.[0])).toContain('hub over cap')
		expect(listing).toHaveBeenCalledOnce()
	})
})

describe('lane_measure_cli.run — over refusals', () => {
	it.each([
		[['stats', '--period', '1', '--over', '0']],
		[['stats', '--period', '1', '--over', '40', '--sinks']],
		[['stats', '--period', '1', '--over', '40', '--limit', '3']],
		[['stats', '--period', '1', '--over', '40', '9']],
	])('refuses %j', async (argv) => {
		vi.spyOn(console, 'error').mockReturnValue(undefined)

		await expect(lane_measure_cli.run(argv, seeded_context())).resolves.toBe(1)
	})
})
