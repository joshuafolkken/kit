import { availableParallelism, loadavg } from 'node:os'
import { core_budget } from '#scripts/gate/core-budget'
import type { Reservation } from '#scripts/gate/core-reservation'
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

type ReservedCommand = NonNullable<LoadEntry['reserved']>[number]
type HeldClaim = Pick<Reservation, 'admitted_at' | 'command' | 'granted' | 'weight'>

// A claim with no command label — a launch that wrote none, or an older marker.
const UNLABELLED_COMMAND = 'unlabelled'

// The cores an admitted claim holds: its narrowed grant where admission narrowed it, else its weight.
// A claim still waiting holds no core, so it is left out (joshuafolkken/kit#9000).
function held_cores(reservation: HeldClaim): number {
	if (reservation.admitted_at === undefined) return 0

	return reservation.granted ?? reservation.weight
}

// The budget's admitted claims summed by command, so a sample reads each kind's CPU against what was
// reserved for it.
function group_reserved(reservations: ReadonlyArray<HeldClaim>): Array<ReservedCommand> {
	const totals = new Map<string, number>()

	for (const reservation of reservations) {
		const command = reservation.command ?? UNLABELLED_COMMAND

		totals.set(command, (totals.get(command) ?? 0) + held_cores(reservation))
	}

	return [...totals]
		.filter(([, cores]) => cores > 0)
		.map(([command, cores]) => ({ command, cores }))
}

// `undefined` where the markers could not be read, so the sample records no reservation rather than none.
function read_reserved(
	read: () => ReadonlyArray<{ reservation: HeldClaim }> = () => core_budget.counted_reservations(),
): Array<ReservedCommand> | undefined {
	try {
		return group_reserved(read().map((entry) => entry.reservation))
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
// The boot and last-wake instants ride along: a reboot resets the counter, and the last wake is where a
// sleep ended, which a sampler started long after it cannot tell from its own first sample.
const CLOCK_SYSCTL_NAMES = ['hw.tbfrequency', 'machdep.wake_abstime', 'machdep.wake_conttime']
const SLEEP_SYSCTL_NAMES = [...CLOCK_SYSCTL_NAMES, 'kern.boottime', 'kern.waketime']
const SYSCTL_LINE = /^(?<name>[\w.]+): (?<value>\d+)$/gmu
const SYSCTL_TIME = /^kern\.(?<name>boottime|waketime): \{ sec = (?<seconds>\d+)/gmu

interface HostSleep {
	slept_ms?: number | undefined
	booted_ms?: number | undefined
	woke_ms?: number | undefined
}

function parse_times(stdout: string): Pick<HostSleep, 'booted_ms' | 'woke_ms'> {
	const times = new Map(
		Array.from(stdout.matchAll(SYSCTL_TIME), (match) => [
			match.groups?.['name'],
			Number(match.groups?.['seconds']) * MS_PER_SECOND,
		]),
	)

	return { booted_ms: times.get('boottime'), woke_ms: times.get('waketime') }
}

function parse_slept_ms(stdout: string): number | undefined {
	const values = new Map(
		Array.from(stdout.matchAll(SYSCTL_LINE), (match) => [
			match.groups?.['name'],
			Number(match.groups?.['value']),
		]),
	)
	const [frequency = 0, awake = 0, total = 0] = CLOCK_SYSCTL_NAMES.map((name) => values.get(name))

	if ([frequency, awake, total].includes(0)) return undefined

	return Math.round(((total - awake) / frequency) * MS_PER_SECOND)
}

async function read_host_sleep(): Promise<HostSleep> {
	if (process.platform !== 'darwin') return {}

	const { stdout } = await execa('sysctl', SLEEP_SYSCTL_NAMES, {
		reject: false,
		timeout: PROBE_TIMEOUT_MS,
	})

	return { slept_ms: parse_slept_ms(stdout), ...parse_times(stdout) }
}

async function sample(at: string): Promise<LoadEntry> {
	const [memory, lanes, reading, host_sleep] = await Promise.all([
		machine_capacity.read_memory(),
		read_lanes(),
		lane_process_load.read(),
		read_host_sleep(),
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
		...host_sleep,
		cores: availableParallelism(),
		reserved: read_reserved(),
	}
}

const lane_load = {
	count_working,
	group_reserved,
	read_reserved,
	parse_slept_ms,
	parse_times,
	sample,
}

export { lane_load }
