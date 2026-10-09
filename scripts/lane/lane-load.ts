import { readFile } from 'node:fs/promises'
import { freemem, loadavg } from 'node:os'
import { execa } from 'execa'
import { lane_await } from './lane-await'
import type { LoadEntry } from './lane-ledger'
import { lane_registry, type LaneInfo } from './lane-registry'

// One machine-load sample for the lane-limit measurement: the one-minute load
// average, free memory, swap in use and how many lanes have a child working, read at one instant so
// `josh lane:stats` can set the load beside the lane count that produced it.
//
// **Swap is read per platform and is optional.** Node exposes no swap figure, so macOS asks `sysctl` and
// Linux reads `/proc/meminfo`; any other platform, or an output neither parser recognizes, records the
// sample without it rather than as a zero nobody measured.

const BYTES_PER_MB = 1_048_576
const MB_PER_GB = 1024
const KB_PER_MB = 1024
const DARWIN_SWAP = /used = (?<amount>[\d.]+)(?<unit>[MG])/u
const LINUX_SWAP_TOTAL = /^SwapTotal:\s+(?<kb>\d+) kB/mu
const LINUX_SWAP_FREE = /^SwapFree:\s+(?<kb>\d+) kB/mu
const MEMINFO_PATH = '/proc/meminfo'
const SYSCTL_ARGUMENTS = ['-n', 'vm.swapusage']
const GB_UNIT = 'G'

// `sysctl -n vm.swapusage` → `total = 5120.00M  used = 3993.25M  free = 1126.75M  (encrypted)`.
function parse_darwin_swap(output: string): number | undefined {
	const groups = DARWIN_SWAP.exec(output)?.groups

	if (groups?.['amount'] === undefined) return undefined

	const scale = groups['unit'] === GB_UNIT ? MB_PER_GB : 1

	return Number(groups['amount']) * scale
}

function kilobytes_of(meminfo: string, pattern: RegExp): number | undefined {
	const kb = pattern.exec(meminfo)?.groups?.['kb']

	return kb === undefined ? undefined : Number(kb)
}

// `/proc/meminfo` carries the total and the free swap; what is in use is their difference.
function parse_linux_swap(meminfo: string): number | undefined {
	const total = kilobytes_of(meminfo, LINUX_SWAP_TOTAL)
	const free = kilobytes_of(meminfo, LINUX_SWAP_FREE)

	if (total === undefined || free === undefined) return undefined

	return (total - free) / KB_PER_MB
}

async function read_swap_mb(
	platform: NodeJS.Platform = process.platform,
): Promise<number | undefined> {
	try {
		if (platform === 'darwin') {
			const { stdout } = await execa('sysctl', SYSCTL_ARGUMENTS)

			return parse_darwin_swap(stdout)
		}

		return platform === 'linux' ? parse_linux_swap(await readFile(MEMINFO_PATH, 'utf8')) : undefined
	} catch {
		return undefined
	}
}

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

async function sample(at: string): Promise<LoadEntry> {
	const [swap_mb, lanes] = await Promise.all([read_swap_mb(), read_lanes()])
	const [load = 0] = loadavg()

	return {
		kind: 'load',
		at,
		load,
		free_mb: Math.round(freemem() / BYTES_PER_MB),
		swap_mb,
		lanes,
	}
}

const lane_load = {
	count_working,
	parse_darwin_swap,
	parse_linux_swap,
	read_swap_mb,
	sample,
}

export { lane_load }
