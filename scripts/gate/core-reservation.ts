import { process_identity } from '#scripts/josh/process-identity'
import { process_owner_schema } from '#scripts/josh/process-owner'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { ReserveOptions } from './core-budget'
import { core_wait } from './core-wait'

// Shared marker storage for gate claims and detached lane memory claims. Optional fields preserve
// compatibility with reservations written by earlier versions.
const reservation_schema = process_owner_schema.extend({
	weight: z.number(),
	claimed_at: z.number(),
	memory_mb: z.number().optional(),
	admitted_at: z.number().optional(),
	is_unit: z.boolean().optional(),
	is_strict_admission: z.boolean().optional(),
	is_memory_pending: z.boolean().optional(),
	granted: z.number().optional(),
	command: z.string().optional(),
	checkout: z.string().optional(),
	lane: z.string().optional(),
	lanes_root: z.string().optional(),
	wait_reason: z.enum(core_wait.WAIT_REASONS).optional(),
})

type Reservation = z.infer<typeof reservation_schema>
type ReservationFields = Omit<Reservation, 'pid' | 'process_start'>

// The target checkout identifies a pending launch even before its worktree exists.
function claim_fields(
	weight: number,
	claimed_at: number,
	options: ReserveOptions,
): ReservationFields {
	const { memory_mb, command, is_unit, is_strict_admission, is_memory_pending } = options

	return {
		weight,
		claimed_at,
		memory_mb,
		command,
		is_unit,
		is_strict_admission,
		is_memory_pending,
		...core_wait.where_of(options.checkout ?? process.cwd()),
	}
}

function read_reservation(source: string): Reservation | undefined {
	const raw = stamp_file.read_stamp_text(source)

	return raw === undefined ? undefined : json_value.parse_with(raw, reservation_schema)
}

// Atomic replacement keeps concurrent ledger readers from seeing a gap in the reservation.
function write_reservation(target: string, fields: ReservationFields): void {
	stamp_file.replace_stamp(target, { ...process_identity.own_fields(), ...fields })
}

// A detached child keeps the admitted memory claim, including its ramp-up window. Dead children
// are swept by the existing pid/start-time check, even after their launcher exits.
function transfer(handle: { target: string }, pid: number): void {
	const reservation = read_reservation(handle.target)

	if (reservation === undefined) {
		throw new Error('The admitted reservation disappeared before transfer')
	}

	stamp_file.replace_stamp(handle.target, {
		...reservation,
		pid,
		process_start: process_identity.read_start(pid),
		is_memory_pending: false,
		admitted_at: Date.now(),
	})
}

const core_reservation = { claim_fields, read_reservation, transfer, write_reservation }

export type { Reservation, ReservationFields }
export { core_reservation }
