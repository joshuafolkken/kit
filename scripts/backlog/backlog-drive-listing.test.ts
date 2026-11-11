import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive } from './backlog-drive'
import type { DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_fixture, type Script } from './backlog-drive-fixture'
import { backlog_drive_listing } from './backlog-drive-listing'

// joshuafolkken/kit#7227: a free seat checks the `auto-ok` listing by its ETag between two asks; an
// unchanged listing leaves `backlog:next` unasked, a changed one asks at once.

const { CONFIG, FIRST_CHILD, harness, state } = backlog_drive_fixture
const CHECK_MS = CONFIG.check_ms
const WATCHED_INTERVALS = 3
const WATCHED_CHECKS = 2

// The elapsed ms of every ask and every listing check.
interface Watch {
	asked_ms: ReadonlyArray<number>
	checked_ms: ReadonlyArray<number>
}

interface Stretch {
	name: string
	in_flight: ReadonlyArray<string>
	script: Script
	interval_ms: number
}

const RUNNING: Stretch = {
	name: 'a lane runs',
	in_flight: [FIRST_CHILD],
	script: {},
	interval_ms: CONFIG.offer_ms,
}
const IDLE: Stretch = {
	name: 'idle with a named issue left',
	in_flight: [],
	script: { is_named_left: true },
	interval_ms: CONFIG.idle_offer_ms,
}

async function watch(
	script: Script,
	in_flight: ReadonlyArray<string>,
	window_ms: number,
): Promise<Watch> {
	const { ports } = harness(script)
	const start_ms = ports.now().getTime()
	const asked_ms: Array<number> = []
	const checked_ms: Array<number> = []

	function elapsed_ms(): number {
		return ports.now().getTime() - start_ms
	}

	await backlog_drive.run_loop(
		state(in_flight),
		{ ...CONFIG, window_ms },
		{
			...ports,
			offer: async (asked) => {
				asked_ms.push(elapsed_ms())

				return await ports.offer(asked)
			},
			listing_changed: async () => {
				checked_ms.push(elapsed_ms())

				return await ports.listing_changed()
			},
		},
	)

	return { asked_ms, checked_ms }
}

describe('backlog_drive.run_loop — an unchanged auto-ok listing', () => {
	it.each([RUNNING, IDLE])('asks only at the interval while $name', async (stretch) => {
		const window_ms = stretch.interval_ms * WATCHED_INTERVALS
		const { asked_ms } = await watch(stretch.script, stretch.in_flight, window_ms)
		const expected = Array.from(
			{ length: WATCHED_INTERVALS + 1 },
			(_, index) => index * stretch.interval_ms,
		)

		expect(asked_ms).toStrictEqual(expected)
	})

	it.each([RUNNING, IDLE])(
		'checks the listing every check interval while $name',
		async (stretch) => {
			const window_ms = CHECK_MS * WATCHED_CHECKS
			const { asked_ms, checked_ms } = await watch(stretch.script, stretch.in_flight, window_ms)

			expect(checked_ms).toStrictEqual([CHECK_MS, CHECK_MS * WATCHED_CHECKS])
			expect(asked_ms).toStrictEqual([0])
		},
	)

	it('leaves the listing unread while no lane is free', async () => {
		const script = { free_lanes: [0], listed_at_ms: 1 }
		const { checked_ms } = await watch(script, [FIRST_CHILD], CONFIG.offer_ms)

		expect(checked_ms).toStrictEqual([])
	})
})

describe('backlog_drive.run_loop — a changed auto-ok listing', () => {
	it('asks at the first check after the listing changed, not after the interval', async () => {
		const script = { listed_at_ms: CHECK_MS * WATCHED_CHECKS - 1 }
		const { asked_ms } = await watch(script, [FIRST_CHILD], CHECK_MS * WATCHED_INTERVALS)

		expect(asked_ms).toStrictEqual([0, CHECK_MS * WATCHED_CHECKS])
	})

	it('hands the loop the check interval the budget names', () => {
		const config = backlog_drive_cli.loop_config(undefined)

		expect(config.check_ms).toBe(backlog_budget.LISTING_CHECK_INTERVAL_MS)
		expect(config.check_ms).toBeLessThan(config.idle_offer_ms)
		expect(config.offer_ms).toBe(backlog_budget.OFFER_INTERVAL_MS)
	})
})

const CONTEXT: DriveContext = {
	owner: String(process.pid),
	active: undefined,
	forwarded: [],
	exclude: [],
	awaited: [],
	window_ms: undefined,
	window: undefined,
	is_only: false,
	stopped: undefined,
}
const LISTED = 7001
const ADDED = 7002
const PULL = 7003
const EARLIER = '2026-11-01T00:00:00Z'
const LATER = '2026-11-02T00:00:00Z'

interface Page {
	numbers: ReadonlyArray<number>
	updated_at: string
	pulls?: ReadonlyArray<number>
}

function body_of(page: Page): string {
	const issues = page.numbers.map((number) => ({ number, updated_at: page.updated_at }))
	const pulls = (page.pulls ?? []).map((number) => ({ number, pull_request: { url: '' } }))

	return JSON.stringify([...issues, ...pulls])
}

// The answers of a fresh watcher over two consecutive first-page reads, each an ETag change.
async function answers(pages: readonly [Page, Page]): Promise<Array<boolean>> {
	const read = vi.spyOn(git_gh_issue, 'issue_list_label_first_page')

	for (const page of pages) read.mockResolvedValueOnce({ body: body_of(page), is_unchanged: false })
	const is_changed = backlog_drive_listing.watcher()
	const baseline = await is_changed()
	const next = await is_changed()

	expect(read).toHaveBeenCalledWith(AUTO_OK_LABEL)

	return [baseline, next]
}

describe('backlog_drive_listing.watcher', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('asks when the first page holds an issue number the previous read lacked', async () => {
		const pages: readonly [Page, Page] = [
			{ numbers: [LISTED], updated_at: EARLIER },
			{ numbers: [LISTED, ADDED], updated_at: EARLIER },
		]

		await expect(answers(pages)).resolves.toStrictEqual([false, true])
	})

	it.each([
		{ name: 'only an issue updated_at changed', next: { numbers: [LISTED], updated_at: LATER } },
		{
			name: 'a pull request was listed',
			next: { numbers: [LISTED], updated_at: EARLIER, pulls: [PULL] },
		},
	])('leaves backlog:next unasked when $name', async ({ next }) => {
		const pages = [{ numbers: [LISTED], updated_at: EARLIER }, next] as const

		await expect(answers(pages)).resolves.toStrictEqual([false, false])
	})

	it('reads a failed read as unchanged', async () => {
		vi.spyOn(git_gh_issue, 'issue_list_label_first_page').mockRejectedValue(new Error('offline'))

		await expect(backlog_drive_listing.watcher()()).resolves.toBe(false)
	})
})

describe('backlog_drive_cli.ports_of — the listing check', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('wires a watcher into the drive loop ports', () => {
		const check = vi.fn(async () => false)

		vi.spyOn(backlog_drive_listing, 'watcher').mockReturnValue(check)
		const holds = { hold: vi.fn(), end: vi.fn() }
		const ports = backlog_drive_cli.ports_of(CONTEXT, [], { state: undefined as never }, holds)

		expect(ports.listing_changed).toBe(check)
	})
})
