import type { machine_capacity, MachineReading } from '#scripts/gate/machine-capacity'
import { vi } from 'vitest'

// **No unit test reads the machine it happens to run on**. The core budget admits against what the machine has free, read by
// `machine_capacity.read_machine` — CPU times over a window, and on macOS `execa('sysctl', …)` for the
// memory pressure. Every suite that drives the gate went through that read, so a suite counting its
// mocked `execa` calls saw an extra `sysctl` on macOS and none on Linux, and a loaded machine held a
// gate's admission past the test timeout.
//
// **This replaces the reading in every worker rather than in each gate suite**, for the reason the
// Telegram guard wraps `fetch`: a suite written later that reaches the gate is covered without knowing
// the probe exists. The reading it answers is "nothing could be read" — the budget a CI runner gets,
// the core count with no memory limit — so the admission is the one the ledger alone decides. The rest
// of the module is the real one, so its parsers and budget arithmetic are still tested as they ship;
// a suite about the reading itself passes its own `read_machine` to `core_budget`.

async function unread_machine(): Promise<MachineReading> {
	return { busy_cores: undefined, available_mb: undefined }
}

vi.mock('#scripts/gate/machine-capacity', async (import_original) => {
	const actual = await import_original<{ machine_capacity: typeof machine_capacity }>()

	return { machine_capacity: { ...actual.machine_capacity, read_machine: unread_machine } }
})
