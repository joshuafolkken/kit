import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_schema_dispatch } from './lane-ledger-schema-dispatch'
import { lane_ledger_write } from './lane-ledger-write'

// joshuafolkken/kit#8815: the implement model a lane child launched on, and why, ride on its dispatch
// row; a row written before them still reads.

const make_directory = temporary_directory('suite')
const scratch = make_directory('lane-ledger-schema-dispatch-test-')
const AT = '2026-11-23T00:00:00.000Z'
const SONNET = 'claude-sonnet-5-5'

describe('lane_ledger_schema_dispatch.dispatch_schema', () => {
	it('reads a dispatch row written before the model and reason', () => {
		const row = { kind: 'dispatch', at: AT, issue: 7 }

		expect(lane_ledger_schema_dispatch.dispatch_schema.parse(row)).toStrictEqual(row)
	})

	it('reads a dispatch row with its model and reason', () => {
		const row = { kind: 'dispatch', at: AT, issue: 7, model: SONNET, reason: 'label' }

		expect(lane_ledger_schema_dispatch.dispatch_schema.parse(row)).toStrictEqual(row)
	})

	it('refuses a reason it does not know', () => {
		const row = { kind: 'dispatch', at: AT, issue: 7, model: SONNET, reason: 'guess' }

		expect(lane_ledger_schema_dispatch.dispatch_schema.safeParse(row).success).toBe(false)
	})
})

describe('lane_ledger_write.record_dispatch — the model and reason', () => {
	it('writes the model and reason and reads them back from the ledger', async () => {
		const target = path.join(scratch, 'dispatch-model.jsonl')

		await lane_ledger_write.record_dispatch({ issue: 7, model: SONNET, reason: 'default' }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'dispatch', issue: 7, model: SONNET, reason: 'default' },
		])
	})
})
