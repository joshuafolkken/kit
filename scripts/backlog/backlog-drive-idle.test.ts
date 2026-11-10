import type { OpenIssueData } from '#scripts/git/git-schemas'
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
		read_measurements: async () => ({ implement_rate: undefined, growth: {} }),
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

// joshuafolkken/kit#5502: `backlog:next` holds an issue declared over the size cap until a person
// splits it, so the notice names it.
describe('backlog_drive_idle.describe — an estimate over the size cap', () => {
	it('lists an issue declared over the cap as waiting on a person to split it', () => {
		const body = `## 背景\n\n- 規模見積もり: 約 25 ファイル / 300 行（テスト除く）\n`
		const over = issue(OVER_CAP, { body })
		const text = backlog_drive_idle.describe({ merged: 0, issues: [...POOL, over], now_ms: NOW_MS })

		expect(text).toContain(
			`(over the size cap or the implement budget, no reason declared):\n- #${String(OVER_CAP)} Issue ${String(OVER_CAP)}`,
		)
		expect(text).not.toContain(`- #${String(READY)}`)
	})

	// joshuafolkken/kit#7006: one within the cap but projected over the implement budget is held too.
	it('lists an issue projected over the implement budget alone', () => {
		const body = `## 背景\n\n- 規模見積もり: 約 1 ファイル / 70 行（テスト除く）\n`
		const over = issue(OVER_CAP, { body })
		const implement_rate = { median: 10, lanes: 4 }
		const text = backlog_drive_idle.describe({
			merged: 0,
			issues: [over],
			now_ms: NOW_MS,
			implement_rate,
		})

		expect(text).toContain(`implement budget, no reason declared):\n- #${String(OVER_CAP)}`)
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
		const read_measurements = vi.fn(async () => ({ implement_rate: undefined, growth: {} }))

		await backlog_drive_idle.notify(
			state(),
			idle_ports({ emit: async () => undefined, send, read_issues, read_measurements }),
		)

		expect(read_issues).not.toHaveBeenCalled()
		expect(read_measurements).not.toHaveBeenCalled()
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

describe('backlog idle measured size classification', () => {
	const over_cap_text = 'over the size cap'
	const body = '## 背景\n\n- 規模見積もり: 約 7 ファイル / 70 行（テスト除く）\n'
	const issues = [issue(OVER_CAP, { body })]
	const reading = { merged: 0, issues, now_ms: NOW_MS }

	it('uses measured growth even without measured speed (ac-54136377)', () => {
		const measured = backlog_drive_idle.describe({ ...reading, growth: { files: 1, lines: 1 } })
		const fallback = backlog_drive_idle.describe(reading)

		expect(measured).not.toContain(over_cap_text)
		expect(fallback).toContain(over_cap_text)
	})

	it('uses the measured guide for the same cap as the offer (ac-54136377)', () => {
		const measured = backlog_drive_idle.describe({
			...reading,
			implement_rate: { median: 3, lanes: 1 },
			growth: { files: 2, lines: 2 },
		})

		expect(measured).not.toContain(over_cap_text)
	})

	it('passes measurements from the fresh notification read into classification', async () => {
		const send = vi.fn(async (_body: string) => true)
		const ports = idle_ports({
			send,
			read_issues: async () => issues,
			read_measurements: async () => ({
				implement_rate: undefined,
				growth: { files: 1, lines: 1 },
			}),
		})

		await backlog_drive_idle.notify(state(), ports)

		expect(send).toHaveBeenCalledOnce()
		expect(send.mock.calls[0]?.[0]).not.toContain(over_cap_text)
	})
})
