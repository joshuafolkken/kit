import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_listing } from './backlog-drive-listing'
import { backlog_listing_trace, type ListingOutcome } from './backlog-listing-trace'
import { backlog_next_shared } from './backlog-next-shared'
import { backlog_offer_timing } from './backlog-offer-timing'

// joshuafolkken/kit#7583: a published issue changed the `auto-ok` listing and woke the waiting driver,
// but its ask replayed the minute-kept `backlog:next` answer from before the publish, and the change,
// already seen, woke nothing more until a merge.

const NEXT_ARGV = ['backlog:next', '--exclude', '7571']
const WAIT: JoshResult = { code: 0, out: 'wait', err: 'explanation' }
const LISTED = 7571
const PUBLISHED = 7578
const EVENT: RunEvent = { pos: 1, kind: 'launch', text: 'launched 1', at: '2026-11-15T12:28:54Z' }

function first_page(numbers: ReadonlyArray<number>): { body: string; is_unchanged: boolean } {
	const labels = [{ name: AUTO_OK_LABEL }]

	return {
		body: JSON.stringify(numbers.map((number) => ({ number, labels }))),
		is_unchanged: false,
	}
}

// The `backlog:next` runs after one ask, two listing checks over these pages, and a second ask.
async function next_runs(pages: ReadonlyArray<ReadonlyArray<number>>): Promise<number> {
	const read = vi.spyOn(git_gh_issue, 'issue_list_label_first_page')

	for (const numbers of pages) read.mockResolvedValueOnce(first_page(numbers))
	const is_changed = backlog_drive_listing.watcher()

	await backlog_next_shared.read(NEXT_ARGV)
	await is_changed()
	await is_changed()
	await backlog_next_shared.read(NEXT_ARGV)

	return vi.mocked(josh_command.josh_run).mock.calls.length
}

describe('backlog_drive_listing.watcher — the kept backlog:next answer', () => {
	beforeEach(() => {
		vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue('/stream/target')
		vi.spyOn(run_event_stream, 'read_last').mockReturnValue(EVENT)
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue(WAIT)

		return shared_cache_fixture.isolate_shared_cache(backlog_next_shared.NEXT_CACHE)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads backlog:next again on the ask a published issue wakes', async () => {
		await expect(next_runs([[LISTED], [PUBLISHED, LISTED]])).resolves.toBe(2)
	})

	it('replays the kept answer while the listing is unchanged', async () => {
		await expect(next_runs([[LISTED], [LISTED]])).resolves.toBe(1)
	})
})

describe('backlog_drive_listing.watcher — the traced outcome', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('notes each check as unchanged, changed or failed', async () => {
		const read = vi.spyOn(git_gh_issue, 'issue_list_label_first_page')
		const note = vi.fn<(outcome: ListingOutcome) => void>()

		read.mockResolvedValueOnce(first_page([LISTED]))
		read.mockResolvedValueOnce(first_page([PUBLISHED, LISTED]))
		read.mockRejectedValueOnce(new Error('offline'))
		const is_changed = backlog_drive_listing.watcher(note)

		await is_changed()
		await is_changed()
		await is_changed()

		expect(note.mock.calls).toStrictEqual([['unchanged'], ['changed'], ['failed']])
	})
})

describe('backlog_offer_timing.is_due — the traced full pool', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('traces a check a full pool skips', async () => {
		const { CONFIG, harness, state } = backlog_drive_fixture
		const note = vi.spyOn(backlog_listing_trace, 'drive').mockImplementation(() => undefined)
		const { ports } = harness({})
		const due_ports = {
			...ports,
			free_lanes: async (): Promise<number> => 0,
			listing_changed: async (): Promise<boolean> => true,
		}
		const run = {
			...backlog_offer_timing.first_run(state([String(LISTED)]), 0),
			offered_ms: 0,
			checked_ms: 0,
		}

		await expect(
			backlog_offer_timing.is_due(run, CONFIG, due_ports, CONFIG.check_ms),
		).resolves.toBe(false)
		expect(note).toHaveBeenCalledExactlyOnceWith('no-free-lane')
	})
})
