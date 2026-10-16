import { availableParallelism } from 'node:os'
import { core_admission } from './core-admission'
import { core_budget, type LiveReservation } from './core-budget'
import { held_mark } from './held-mark'
import { machine_capacity, type MachineReading } from './machine-capacity'

// The cores a unit suite may open workers on: the core count less the load from outside the core
// budget's ledger, the figure the ledger admits against (`machine_capacity.machine_budget`). The run
// count in `unit-worker-share.ts` divides the machine between unit runs; this is what bounds that
// division when something else holds the cores.
//
// Its own module because the reading needs the ledger, and `core-budget.ts` already imports
// `unit-worker-share.ts` — reading it from there would close a cycle.

interface FreeCoresOptions {
	available_cores?: number
	read_machine?: () => Promise<MachineReading>
	directory?: string
}

// **The claim a parent command holds for this run is left out of the ledger.** It is admitted before
// this run starts a worker, so none of its weight is in the reading yet; counting it would subtract
// it from load it never added and mask that much outside load (`held_mark.held_reservation`).
function running_claims(directory: string | undefined): Array<LiveReservation> {
	const own = held_mark.held_reservation()

	return core_budget.live_reservations(directory).filter((entry) => entry.key !== own)
}

// `undefined` where the machine could not be read — a CI runner, a CPU quota narrower than the host —
// which `unit_worker_share.cap_to_free` reads as the share as it was.
async function read(options: FreeCoresOptions = {}): Promise<number | undefined> {
	const reading = await (options.read_machine ?? machine_capacity.read_machine)()

	if (reading.busy_cores === undefined) return undefined

	const ledger = core_admission.ledger_load(running_claims(options.directory), Date.now())

	return machine_capacity.machine_budget(
		options.available_cores ?? availableParallelism(),
		reading,
		ledger,
	).cores
}

const free_cores = { read }

export type { FreeCoresOptions }
export { free_cores }
