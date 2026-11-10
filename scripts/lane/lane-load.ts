import { loadavg } from 'node:os'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { MS_PER_SECOND, PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { lane_await } from './lane-await'
import type { LoadEntry } from './lane-ledger-schema'
import { lane_process_load } from './lane-process-load'
import { lane_registry, type LaneInfo } from './lane-registry'

// One machine-load sample for the lane-limit measurement: the one-minute load
// average, available memory, the swap counter, how many lanes have a child working and the heaviest
// process kinds (`lane-process-load.ts`), read at one
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

// The host's sleep since boot (joshuafolkken/kit#7026): at each wake macOS stamps both its continuous
// clock, which runs through a sleep, and its absolute one, which stops, in timebase ticks. Their
// difference grows only by sleeping, so two samples' readings give the sleep between them even when
// different processes took them. Another platform, or a probe that did not answer, records none.
const SLEEP_SYSCTL_NAMES = ['hw.tbfrequency', 'machdep.wake_abstime', 'machdep.wake_conttime']
const SYSCTL_LINE = /^(?<name>[\w.]+): (?<value>\d+)$/gmu

function parse_slept_ms(stdout: string): number | undefined {
	const values = new Map(
		Array.from(stdout.matchAll(SYSCTL_LINE), (match) => [
			match.groups?.['name'],
			Number(match.groups?.['value']),
		]),
	)
	const [frequency = 0, awake = 0, total = 0] = SLEEP_SYSCTL_NAMES.map((name) => values.get(name))

	if ([frequency, awake, total].includes(0)) return undefined

	return Math.round(((total - awake) / frequency) * MS_PER_SECOND)
}

async function read_slept_ms(): Promise<number | undefined> {
	if (process.platform !== 'darwin') return undefined

	const { stdout } = await execa('sysctl', SLEEP_SYSCTL_NAMES, {
		reject: false,
		timeout: PROBE_TIMEOUT_MS,
	})

	return parse_slept_ms(stdout)
}

async function sample(at: string): Promise<LoadEntry> {
	const [memory, lanes, reading, slept_ms] = await Promise.all([
		machine_capacity.read_memory(),
		read_lanes(),
		lane_process_load.read(),
		read_slept_ms(),
	])
	const [load = 0] = loadavg()

	return {
		kind: 'load',
		at,
		load,
		available_mb: rounded(memory.available_mb),
		swapped_mb: rounded(memory.swapped_mb),
		lanes,
		processes: reading?.processes,
		resident_mb: reading?.resident_mb,
		slept_ms,
	}
}

const lane_load = {
	count_working,
	parse_slept_ms,
	sample,
}

export { lane_load }
