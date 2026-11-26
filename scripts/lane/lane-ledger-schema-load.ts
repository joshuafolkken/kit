import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The machine-load sample `lane-sampler.ts` writes once a minute, joined into the entry union by
// `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// One process kind's summed readings (`lane-process-load.ts`). `footprint_mb` counts the compressed
// pages `rss_mb` leaves out (joshuafolkken/kit#7244); absent where no footprint could be read, and on
// rows written before it.
const process_kind_schema = z.object({
	kind: z.string(),
	cpu_percent: z.number(),
	rss_mb: z.number(),
	footprint_mb: z.number().optional(),
	count: z.number(),
})
// One command's admitted core-budget claims at the instant of the sample (`lane-load.ts`), summed, so the
// CPU a process kind used reads against what the budget had reserved for it (joshuafolkken/kit#9000).
const reserved_command_schema = z.object({
	command: z.string(),
	cores: z.number(),
})
// `available_mb`, `swapped_mb` and `lanes` are optional because each read can fail on its own — a
// platform with no memory reading, a `git worktree` call that did not answer — and a sample is still
// worth its load. `swapped_mb` is `machine_capacity`'s counter, every page swapped since boot.
// Both memory fields were renamed with their meaning (joshuafolkken/kit#3593): an older row's
// `free_mb` / `swap_mb` are stripped on read, so the two measurements never share a column.
const load_schema = z.object({
	kind: z.literal(KIND.LOAD),
	at: z.string(),
	load: z.number(),
	available_mb: z.number().optional(),
	swapped_mb: z.number().optional(),
	lanes: z.number().optional(),
	// The heaviest process kinds at the instant of the sample (`lane-process-load.ts`), so the load the
	// core budget's ledger does not explain can be read back by what made it (joshuafolkken/kit#3874).
	processes: z.array(process_kind_schema).optional(),
	// The resident apps' summed size (`lane_process_load.RESIDENT_APPS`, joshuafolkken/kit#5658).
	resident_mb: z.number().optional(),
	// The host's sleep since boot (`lane-load.ts`, joshuafolkken/kit#7026).
	slept_ms: z.number().optional(),
	// The boot and last-wake instants, epoch ms (`kern.boottime`, `kern.waketime`).
	booted_ms: z.number().optional(),
	woke_ms: z.number().optional(),
	// The machine's core count and the budget's admitted claims by command (joshuafolkken/kit#9000), so a
	// sample whose load passed the cores reads as unreserved work or a claim using more than it reserved.
	// Absent on rows written before them, or where the reservations could not be read.
	cores: z.number().optional(),
	reserved: z.array(reserved_command_schema).optional(),
})

const lane_ledger_schema_load = { load_schema }

export { lane_ledger_schema_load }
