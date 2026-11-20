import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_kind } from './lane-ledger-kind'
import type { ChainStageLedgerRecord } from './lane-ledger-schema-ship'
import { lane_ledger_write_chain_stage } from './lane-ledger-write-chain-stage'

const make_directory = temporary_directory('suite')
const { KIND } = lane_ledger_kind

// joshuafolkken/kit#8286: each `run:chain` stage is one ledger line, appended as it ends.

const scratch = make_directory('lane-ledger-write-chain-stage-test-')
const AT = '2026-11-20T00:00:00.000Z'
const ISSUE = 8286
const ELAPSED_MS = 1500
const PASSED: ChainStageLedgerRecord = {
	issue: ISSUE,
	name: 'check:related',
	at: AT,
	elapsed_ms: ELAPSED_MS,
	result: 'passed',
}
const STOPPED: ChainStageLedgerRecord = {
	issue: ISSUE,
	name: 'run:review',
	at: AT,
	elapsed_ms: 0,
	result: 'stopped',
}

describe('lane_ledger_write_chain_stage.record_chain_stage', () => {
	it('appends one chain-stage line per call that reads back through the ledger', async () => {
		const target = path.join(scratch, 'chain-stage.jsonl')

		await lane_ledger_write_chain_stage.record_chain_stage(PASSED, target)
		await lane_ledger_write_chain_stage.record_chain_stage(STOPPED, target)

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: KIND.CHAIN_STAGE, ...PASSED },
			{ kind: KIND.CHAIN_STAGE, ...STOPPED },
		])
	})
})
