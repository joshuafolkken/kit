import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'

// joshuafolkken/kit#4749: `josh lane:net <issue>` prints a lane's net minutes, the waits its parks and
// outages stood taken out and rounded up, so a lane above the overrun threshold cannot print the threshold itself.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-measure-cli-net-test-'))
const ISSUE = 4695
const FAILURE = 1

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

function fresh_context(): { ledger_path: string; events_path: string } {
	return {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
	}
}

describe('lane_measure_cli.run — net', () => {
	it('prints the whole net minutes of a lane whose park waited on a person', async () => {
		const context = fresh_context()

		lane_ledger_write.append(context.ledger_path, {
			kind: 'dispatch',
			at: '2026-10-24T03:00:00.000Z',
			issue: ISSUE,
		})
		run_event_stream.append(
			context.events_path,
			'park',
			`#${String(ISSUE)} parked`,
			'2026-10-24T03:20:00.000Z',
		)
		lane_ledger_write.append(context.ledger_path, {
			kind: 'dispatch',
			at: '2026-10-24T03:50:00.000Z',
			issue: ISSUE,
		})
		lane_ledger_write.append(context.ledger_path, {
			kind: 'merge',
			at: '2026-10-24T04:04:20.000Z',
			issue: ISSUE,
		})

		await expect(lane_measure_cli.run(['net', String(ISSUE)], context)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('35')
	})

	it('fails when the ledger holds no merge of the lane', async () => {
		await expect(lane_measure_cli.run(['net', String(ISSUE)], fresh_context())).resolves.toBe(
			FAILURE,
		)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no dispatch and merge'))
	})
})
