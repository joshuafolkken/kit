import { z } from 'zod'

// The pair a record names its writing process by, as `process_identity` reads it back
// (joshuafolkken/kit#1245): the pid, and the opaque start token `process_identity.own_fields` wrote
// beside it. Every lock, marker and ledger entry that later asks `is_same_process` carries this pair,
// so its shape is declared once here and each record extends it (joshuafolkken/kit#2986).
//
// `process_start` is optional because a record written before joshuafolkken/kit#1245, or on a platform
// whose start time cannot be read, carries only the pid — `is_same_process` has an answer of its own
// for that case rather than the record being rejected.
const process_owner_schema = z.object({ pid: z.number(), process_start: z.string().optional() })

type ProcessOwner = z.infer<typeof process_owner_schema>

export { process_owner_schema }
export type { ProcessOwner }
