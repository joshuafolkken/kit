import { lane_ledger_kind } from './lane-ledger-kind'
import type { ChainStageLedgerRecord } from './lane-ledger-schema-ship'
import { lane_ledger_write } from './lane-ledger-write'

// The `chain-stage` line `josh run:chain` appends as each stage ends (joshuafolkken/kit#8286), kept
// apart from `lane-ledger-write.ts`, which is past the file limit. Best-effort like every ledger write:
// a failed append never stops the run it measures.

const { KIND } = lane_ledger_kind

async function record_chain_stage(stage: ChainStageLedgerRecord, path?: string): Promise<void> {
	await lane_ledger_write.record({ kind: KIND.CHAIN_STAGE, ...stage }, path)
}

const lane_ledger_write_chain_stage = { record_chain_stage }

export { lane_ledger_write_chain_stage }
