import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_net_read } from './lane-net-read'

// joshuafolkken/kit#5225: one lane's net minutes read from the ledger and the event stream, shared by
// `josh lane:net` and the causing-lane line `josh issue:file --found-during` prints.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-net-read-test-'))
const ISSUE = 5168
const DISPATCHED_AT = '2026-10-24T03:00:00.000Z'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// A fresh ledger holding the lane's dispatch, and an empty event stream beside it.
function dispatched_context(): { ledger_path: string; events_path: string } {
	const context = {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
	}

	lane_ledger_write.append(context.ledger_path, {
		kind: 'dispatch',
		at: DISPATCHED_AT,
		issue: ISSUE,
	})

	return context
}

describe('lane_net_read.net_minutes_of', () => {
	it('reads the whole net minutes of a dispatched and merged lane', async () => {
		const context = dispatched_context()

		lane_ledger_write.append(context.ledger_path, {
			kind: 'merge',
			at: '2026-10-24T03:20:30.000Z',
			issue: ISSUE,
		})

		await expect(lane_net_read.net_minutes_of(ISSUE, context)).resolves.toBe(21)
	})

	it('is undefined for a lane the ledger holds no merge of', async () => {
		await expect(lane_net_read.net_minutes_of(ISSUE, dispatched_context())).resolves.toBeUndefined()
	})
})

// The dispatched lane implemented until its ship started, sized at twice its declared lines and merged.
function measured_context(): { ledger_path: string; events_path: string } {
	const context = dispatched_context()
	const shipped_at = '2026-10-24T03:20:00.000Z'

	for (const entry of [
		{ kind: 'stage', at: shipped_at, stage: 'preflight', elapsed_ms: 0, issue: ISSUE },
		{
			kind: 'size',
			at: shipped_at,
			issue: ISSUE,
			declared: { files: 1, lines: 100 },
			actual: { files: 1, lines: 200 },
		},
		{ kind: 'merge', at: '2026-10-24T03:30:00.000Z', issue: ISSUE },
	] as const) {
		lane_ledger_write.append(context.ledger_path, entry)
	}

	return context
}

// joshuafolkken/kit#6025: the recent implement rate `issue:file` projects a declared size by.
describe('lane_net_read.implement_rate', () => {
	it('is undefined when no merged lane in the window measured a rate', async () => {
		const now_ms = Date.parse(DISPATCHED_AT)

		await expect(
			lane_net_read.implement_rate(dispatched_context(), now_ms),
		).resolves.toBeUndefined()
	})

	it('reads the median of a sized and merged lane in the window', async () => {
		const rate = await lane_net_read.implement_rate(
			measured_context(),
			Date.parse('2026-10-24T04:00:00.000Z'),
		)

		expect(rate).toStrictEqual({ median: 10, lanes: 1 })
	})
})
