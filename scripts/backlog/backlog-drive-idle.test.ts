import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_human_stops } from '#scripts/issue/issue-human-stops'
import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_idle, type IdlePorts } from './backlog-drive-idle'

// joshuafolkken/kit#4015: the one notification an idle backlogrun sends — a watch with no child running.

const { FIRST_CHILD, harness, offer, state } = backlog_drive_fixture
const DATE = '2026-10-20T09:30Z'
const NOW_MS = Date.parse('2026-10-18T00:00Z')
const PARKED = 4101
const DATED = 4102
const READY = 4103
const STALLED = 4104
const UNTRUSTED = 4105
const OVER_CAP = 4106
const IDLE_TEXT = 'idle body'

// The pool as `auto_ok_cli.fetch_opted_in` answers it: each row's author trust already assembled.
function issue(number: number, extra: Partial<OpenIssueData> = {}): OpenIssueData {
	return {
		number,
		title: `Issue ${String(number)}`,
		createdAt: DATE,
		author_trusted: true,
		...extra,
	}
}

const POOL: ReadonlyArray<OpenIssueData> = [
	issue(PARKED, { labels: [{ name: 'auto-ok' }, { name: 'needs-decision' }] }),
	issue(DATED, { body: `## 背景\n\n- 実施可能日: ${DATE}\n\n## 現象\n` }),
	issue(READY, { labels: [{ name: 'auto-ok' }] }),
]

function idle_ports(overrides: Partial<IdlePorts>): IdlePorts {
	return {
		read_issues: async () => POOL,
		emit: async (compose) => await compose(),
		send: async () => true,
		now_ms: () => NOW_MS,
		...overrides,
	}
}

describe('backlog_drive — the idle port', () => {
	it('notices a watch with nothing in flight', async () => {
		const { ports, idles } = harness({ offers: [{ ...offer('watch'), answer: 'parked' }] })

		await backlog_drive.run_pass(state(), true, ports)

		expect(idles).toHaveLength(1)
	})

	it('stays quiet while a child is still running, or on any other verdict', async () => {
		const running = harness({ offers: [offer('watch')] })
		const waiting = harness({ offers: [offer('wait')] })

		await backlog_drive.run_pass(state([FIRST_CHILD]), true, running.ports)
		await backlog_drive.run_pass(state(), true, waiting.ports)

		expect([...running.idles, ...waiting.idles]).toStrictEqual([])
	})

	it('stays quiet on a transient retry, which leaves the backlog unknown rather than empty', async () => {
		const { ports, idles } = harness({ offers: [{ ...offer('watch'), answer: 'blocked' }] })

		await backlog_drive.run_pass(state(), true, ports)

		expect(idles).toStrictEqual([])
	})
})

describe('backlog_drive_idle.describe', () => {
	it('lists the parked and the dated issues with the merged count', () => {
		const body = backlog_drive_idle.describe({ merged: 3, issues: POOL, now_ms: NOW_MS })

		expect(body).toContain('Merged this run: 3')
		expect(body).toContain(`#${String(PARKED)} Issue ${String(PARKED)}`)
		expect(body).toContain(`#${String(DATED)} Issue ${String(DATED)} — not before ${DATE}`)
		expect(body).not.toContain(`#${String(READY)}`)
	})

	it('says so when nothing is parked or dated, or the pool is unreadable', () => {
		const empty = backlog_drive_idle.describe({ merged: 0, issues: [], now_ms: NOW_MS })
		const unreadable = backlog_drive_idle.describe({ merged: 0, issues: undefined, now_ms: NOW_MS })

		expect(empty).toContain('Nothing parked or dated is left.')
		expect(unreadable).toContain('Remaining issues: unreadable')
	})

	// joshuafolkken/kit#4102: a mechanical park asks for a fix, not a decision, so it has its own heading.
	it('lists a run:stalled issue under its own heading, apart from the decisions', () => {
		const stalled = issue(STALLED, { labels: [{ name: 'run:stalled' }] })
		const body = backlog_drive_idle.describe({
			merged: 0,
			issues: [...POOL, stalled],
			now_ms: NOW_MS,
		})

		expect(body).toContain(
			`Waiting on a decision (needs-decision):\n- #${String(PARKED)} Issue ${String(PARKED)}\n`,
		)
		expect(body).toContain(
			`Stalled mechanically (run:stalled):\n- #${String(STALLED)} Issue ${String(STALLED)}\n`,
		)
	})
})

// joshuafolkken/kit#4633: `backlog:next` holds an issue whose author lacks write access for a person,
// so the notice that asks for a person's hand names it.
describe('backlog_drive_idle.describe — an author without write access', () => {
	it('lists an issue whose author lacks write access as waiting on a person', () => {
		const untrusted = issue(UNTRUSTED, { author_trusted: false })
		const body = backlog_drive_idle.describe({
			merged: 0,
			issues: [...POOL, untrusted],
			now_ms: NOW_MS,
		})

		expect(body).toContain(
			`(author without write access):\n- #${String(UNTRUSTED)} Issue ${String(UNTRUSTED)}`,
		)
		expect(body).not.toContain(`- #${String(READY)}`)
	})
})

// joshuafolkken/kit#7080: every stop the registry lists for the notice gets its heading here.
describe('backlog_drive_idle.describe — the registry of a person stops', () => {
	it.each(issue_human_stops.idle_stops().filter((stop) => stop.label !== undefined))(
		'lists an issue carrying $key under its heading',
		(stop) => {
			const waiting = issue(PARKED, { labels: [{ name: stop.label ?? '' }] })
			const body = backlog_drive_idle.describe({ merged: 0, issues: [waiting], now_ms: NOW_MS })

			expect(body).toContain(
				`${stop.idle_heading ?? ''}\n- #${String(PARKED)} Issue ${String(PARKED)}`,
			)
		},
	)

	it('lists already-done and needs-human-merge as waiting on a person', () => {
		const done = issue(PARKED, { labels: [{ name: 'already-done' }] })
		const merge = issue(STALLED, { labels: [{ name: 'needs-human-merge' }] })
		const body = backlog_drive_idle.describe({ merged: 0, issues: [done, merge], now_ms: NOW_MS })

		expect(body).toContain(`(already-done):\n- #${String(PARKED)}`)
		expect(body).toContain(`(needs-human-merge):\n- #${String(STALLED)}`)
	})
})

// joshuafolkken/kit#7074: `backlog:next` offers an issue over the size cap with a note rather than
// holding it, so the notice no longer names it as waiting on a person.
describe('backlog_drive_idle.describe — an estimate over the size cap', () => {
	it('names no issue over the cap as waiting on a person', () => {
		const body = `## 背景\n\n- 規模見積もり: 約 25 ファイル / 300 行（テスト除く）\n`
		const over = issue(OVER_CAP, { body })
		const text = backlog_drive_idle.describe({ merged: 0, issues: [...POOL, over], now_ms: NOW_MS })

		expect(text).not.toContain('size cap')
		expect(text).not.toContain(`- #${String(OVER_CAP)}`)
	})
})

describe('backlog_drive_idle.notify', () => {
	it('sends the body the marker appended', async () => {
		const send = vi.fn(async (_body: string) => true)

		await backlog_drive_idle.notify(state(), idle_ports({ send }))

		expect(send).toHaveBeenCalledOnce()
		expect(send.mock.calls[0]?.[0]).toContain(`#${String(PARKED)}`)
	})

	it('neither reads the pool nor sends while the episode is already marked', async () => {
		const send = vi.fn(async () => true)
		const read_issues = vi.fn(async () => POOL)

		await backlog_drive_idle.notify(
			state(),
			idle_ports({ emit: async () => undefined, send, read_issues }),
		)

		expect(read_issues).not.toHaveBeenCalled()
		expect(send).not.toHaveBeenCalled()
	})

	it('drops a failed read rather than raising it into the watch', async () => {
		const failing = idle_ports({
			emit: async () => {
				throw new Error(IDLE_TEXT)
			},
		})

		await expect(backlog_drive_idle.notify(state(), failing)).resolves.toBeUndefined()
	})
})
