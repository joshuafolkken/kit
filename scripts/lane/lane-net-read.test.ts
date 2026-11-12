import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_net_read } from './lane-net-read'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5225: one lane's net minutes read from the ledger and the event stream, shared by
// `josh lane:net` and the causing-lane line `josh issue:file --found-during` prints.

const scratch = make_directory('lane-net-read-test-')
const ISSUE = 5168
const DISPATCHED_AT = '2026-10-24T03:00:00.000Z'

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
