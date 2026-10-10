import { loadavg } from 'node:os'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { lane_await } from './lane-await'
import type { LoadEntry } from './lane-ledger'
import { lane_registry, type LaneInfo } from './lane-registry'

// One machine-load sample for the lane-limit measurement: the one-minute load
// average, available memory, the swap counter and how many lanes have a child working, read at one
// instant so `josh lane:stats` can set the load beside the lane count that produced it.
//
// **The memory is `machine_capacity`'s reading, the one the gate admits against.** `os.freemem()` reads
// near zero on macOS with gigabytes to spare, and a second swap parser here measured swap in use while
// the gate measured pages swapped — two figures for one machine. `swapped_mb` is that counter, every
// page swapped since boot, so `lane:stats` reads a rate from the difference between two samples.
//
// **Either figure is optional.** A platform the reading does not cover, or a probe that did not answer,
// records the sample without it rather than as a zero nobody measured.

// The lanes with a child at work. An open lane is not enough: a stranded lane, or one a park kept, holds
// a tree but no running child, so it adds no load — the child's process is what `lane:await` polls.
function count_working(
	lanes: ReadonlyArray<LaneInfo>,
	is_running: (issue: string) => boolean = lane_await.is_process_running_default,
): number {
	return lanes.filter((lane) => !lane.is_stranded && is_running(lane.issue)).length
}

async function read_lanes(): Promise<number | undefined> {
	try {
		return count_working(await lane_registry.list_lanes())
	} catch {
		return undefined
	}
}

function rounded(megabytes: number | undefined): number | undefined {
	return megabytes === undefined ? undefined : Math.round(megabytes)
}

async function sample(at: string): Promise<LoadEntry> {
	const [memory, lanes] = await Promise.all([machine_capacity.read_memory(), read_lanes()])
	const [load = 0] = loadavg()

	return {
		kind: 'load',
		at,
		load,
		available_mb: rounded(memory.available_mb),
		swapped_mb: rounded(memory.swapped_mb),
		lanes,
	}
}

const lane_load = {
	count_working,
	sample,
}

export { lane_load }
