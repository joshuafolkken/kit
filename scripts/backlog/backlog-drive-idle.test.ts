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
const IDLE_TEXT = 'idle body'

function issue(number: number, extra: Partial<OpenIssueData> = {}): OpenIssueData {
	return { number, title: `Issue ${String(number)}`, createdAt: DATE, ...extra }
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
