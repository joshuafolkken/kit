import { availableParallelism } from 'node:os'
import type { FreeCapacity } from '#scripts/test/unit-worker-share'
import { core_admission } from './core-admission'
import { core_budget, type LiveReservation } from './core-budget'
import { core_weights } from './core-weights'
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
function free_of(reading: MachineReading, options: FreeCoresOptions): number | undefined {
	if (reading.busy_cores === undefined) return undefined

	const ledger = core_admission.ledger_load(running_claims(options.directory), Date.now())

	return machine_capacity.machine_budget(
		options.available_cores ?? availableParallelism(),
		reading,
		ledger,
	).cores
}

// **The workers the free memory holds** (joshuafolkken/kit#4528): the free memory over one worker's
// peak (`core_weights.MEMORY_MB.unit_worker`, where its measurement is recorded). Divided here, not in
// `unit-worker-share.ts`, which the vitest config imports — `core-weights.ts` there would widen every
// related run on it to the whole suite. The memory is the reading's own available figure, not the
// budget's: the ledger's held memory is added back there for admission's walk, and it is not free for
// this run's workers. `undefined` — a platform `machine-capacity.ts` reads no memory on — leaves the
// share as it was; a Linux CI runner reads `/proc/meminfo`, whose memory holds more workers than cores.
function workers_in_memory(available_mb: number | undefined): number | undefined {
	if (available_mb === undefined) return undefined

	return available_mb / core_weights.MEMORY_MB.unit_worker
}

// One reading answers both halves: the sample window is waited out once.
async function read(options: FreeCoresOptions = {}): Promise<FreeCapacity> {
	const reading = await (options.read_machine ?? machine_capacity.read_machine)()

	return {
		cores: free_of(reading, options),
		memory_workers: workers_in_memory(reading.available_mb),
	}
}

const free_cores = { read }

export type { FreeCoresOptions }
export { free_cores }
