import type { dlopen } from 'node:ffi'

// A process's CPU time with the children it has reaped folded in, so a vitest worker or a gate's
// eslint born and gone between two `run:board` samples still reaches its lane through its parent.
// macOS's `ps -S` does not fold them; the kernel keeps them in `proc_pid_rusage`'s
// `ri_child_user_time` / `ri_child_system_time`, reached here through `node:ffi`.
//
// **`node:ffi` is experimental** — added in Node 26 (kit's `engines` is `^22.19.0 || ^24.0.0 ||
// >=26.0.0`) and liable to change. Where it is missing, or the platform is not macOS, or a call
// fails, there is no reader and the board keeps `ps`'s own-time figure. Loading it emits an
// `ExperimentalWarning`, which would land on the board's alternate screen, so the load alone drops it.

// The one part of `node:ffi` the board calls.
interface Ffi {
	dlopen: typeof dlopen
}

type ModuleLoad = (id: string) => unknown

// `ri_*` times are mach absolute time units, which `mach_timebase_info`'s numer / denom turn into ns.
interface Timebase {
	numer: number
	denom: number
}

// The CPU milliseconds of one process, `undefined` where it cannot be read (gone, or another user's).
type RusageReader = (pid: number) => number | undefined

const PROC_LIBRARY = '/usr/lib/libproc.dylib'
const SYSTEM_LIBRARY = '/usr/lib/libSystem.B.dylib'
const RUSAGE_INFO_V2 = 2
const RUSAGE_INFO_V2_BYTES = 160
// `rusage_info_v2`'s `ri_user_time`, `ri_system_time`, `ri_child_user_time`, `ri_child_system_time`.
const USER_TIME_OFFSET = 16
const SYSTEM_TIME_OFFSET = 24
const CHILD_USER_TIME_OFFSET = 96
const CHILD_SYSTEM_TIME_OFFSET = 104
const TIME_OFFSETS = [
	USER_TIME_OFFSET,
	SYSTEM_TIME_OFFSET,
	CHILD_USER_TIME_OFFSET,
	CHILD_SYSTEM_TIME_OFFSET,
]
const TIMEBASE_BYTES = 8
const DENOM_OFFSET = 4
const NS_PER_MS = 1_000_000
const EXPERIMENTAL_WARNING = 'ExperimentalWarning'
const DARWIN: NodeJS.Platform = 'darwin'

const PROC_PID_RUSAGE = {
	proc_pid_rusage: { arguments: ['int32', 'int32', 'buffer'], return: 'int32' },
} as const
const MACH_TIMEBASE_INFO = {
	mach_timebase_info: { arguments: ['buffer'], return: 'int32' },
} as const

// The four times of an `rusage_info_v2`, in milliseconds.
function cpu_ms_of(buffer: Buffer, timebase: Timebase): number {
	const ticks = TIME_OFFSETS.reduce(
		(sum, offset) => sum + Number(buffer.readBigUInt64LE(offset)),
		0,
	)

	return (ticks * timebase.numer) / timebase.denom / NS_PER_MS
}

// `node:ffi`, its load's `ExperimentalWarning` dropped — the load is synchronous, so no other warning
// can fall inside the window.
function quiet_ffi(load: ModuleLoad): Ffi | undefined {
	const emit_warning = process.emitWarning

	process.emitWarning = function quiet(warning: string | Error, ...rest: Array<unknown>): void {
		if (rest[0] !== EXPERIMENTAL_WARNING) Reflect.apply(emit_warning, process, [warning, ...rest])
	}

	try {
		return load('node:ffi') as Ffi | undefined
	} finally {
		process.emitWarning = emit_warning
	}
}

function timebase_of(ffi: Ffi): Timebase {
	const buffer = Buffer.alloc(TIMEBASE_BYTES)

	ffi.dlopen(SYSTEM_LIBRARY, MACH_TIMEBASE_INFO).functions.mach_timebase_info(buffer)

	return { numer: buffer.readUInt32LE(0), denom: buffer.readUInt32LE(DENOM_OFFSET) }
}

function reader_of(ffi: Ffi): RusageReader {
	const timebase = timebase_of(ffi)
	const { proc_pid_rusage } = ffi.dlopen(PROC_LIBRARY, PROC_PID_RUSAGE).functions
	const buffer = Buffer.alloc(RUSAGE_INFO_V2_BYTES)

	return function read(pid: number): number | undefined {
		const status = proc_pid_rusage(pid, RUSAGE_INFO_V2, buffer)

		return status === 0 ? cpu_ms_of(buffer, timebase) : undefined
	}
}

function load_builtin(id: string): unknown {
	return process.getBuiltinModule(id)
}

// `load` answers `undefined` for a module this Node lacks, as `process.getBuiltinModule` does; there,
// and off macOS, there is no reader and every process keeps `ps`'s figure.
function rusage_reader(platform: NodeJS.Platform, load: ModuleLoad): RusageReader | undefined {
	if (platform !== DARWIN) return undefined

	try {
		const ffi = quiet_ffi(load)

		return ffi === undefined ? undefined : reader_of(ffi)
	} catch {
		return undefined
	}
}

const run_board_usage_rusage = { cpu_ms_of, load_builtin, quiet_ffi, rusage_reader }

export { run_board_usage_rusage }
export type { RusageReader, Timebase }
