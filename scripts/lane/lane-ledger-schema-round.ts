import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The review-round decisions and the run-pacing observations a ship and the driver record, joined into
// the entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// The round 1 a `josh ship` acted on for `issue`: `verdict` is the reviewer's — `clean`, `fixed`,
// `blocking` — or `reused` where a round recorded before the ship still described the tree, so the
// period's ship-time rounds that passed with no fix are counted (joshuafolkken/kit#4620).
const round_one_schema = z.object({
	kind: z.literal(KIND.ROUND_ONE),
	at: z.string(),
	issue: z.number(),
	verdict: z.string(),
})
// One `review:round2` decision a `josh ship` acted on for `issue`: `verdict` and the stable reason
// `code` it fell under, so the period's skips and runs are counted by why (joshuafolkken/kit#4064).
// `findings` is a run's outcome — its `<category>:<severity>` kinds, empty when it found nothing — and
// absent on a skip, a run that reached no verdict, or a record written before it (joshuafolkken/kit#7873).
const round_two_schema = z.object({
	kind: z.literal(KIND.ROUND_TWO),
	at: z.string(),
	issue: z.number(),
	verdict: z.string(),
	code: z.string(),
	findings: z.array(z.string()).optional(),
})
// A stall detector observation, written only when it changes: whether offerable backlog work and a free
// lane coexisted, so a stall is aged from when both first held rather than from the last launch
// (joshuafolkken/kit#4349).
const offerable_schema = z.object({
	kind: z.literal(KIND.OFFERABLE),
	at: z.string(),
	is_offerable: z.boolean(),
})
// One claim that waited `waited_ms` for the core budget before `command` could start — written by the
// command itself, so a wait inside a gate, a scoped check or a ship lands in one record. `issue` is the
// lane the claim ran in, absent outside a lane (joshuafolkken/kit#4382).
const core_wait_schema = z.object({
	kind: z.enum([KIND.CORE_WAIT, KIND.CORE_ADMISSION]),
	at: z.string(),
	command: z.string(),
	waited_ms: z.number(),
	issue: z.number().optional(),
	admission_reason: z.string().optional(),
	overflow: z.boolean().optional(),
	budget_cores: z.number().optional(),
	budget_memory_mb: z.number().optional(),
	available_mb: z.number().optional(),
	busy_cores: z.number().optional(),
	// The cores the admitted claims held at the admission (joshuafolkken/kit#8869).
	reserved_cores: z.number().optional(),
	requested_cores: z.number().optional(),
	granted_cores: z.number().optional(),
	memory_mb: z.number().optional(),
	wait_reason: z.string().optional(),
	admission_waited_ms: z.number().optional(),
	memory_pressured: z.boolean().optional(),
})

const lane_ledger_schema_round = {
	round_one_schema,
	round_two_schema,
	offerable_schema,
	core_wait_schema,
}

export { lane_ledger_schema_round }
