import { z } from 'zod'

// What started a `josh test:pinned` run (joshuafolkken/kit#5262), in a leaf of its own
// (joshuafolkken/kit#5334): `test-pinned-ledger.ts` parses `--origin` with it on a path most suites
// import, so reading it from `lane-ledger-schema.ts` made every ledger schema change reach them.
const pinned_origin_schema = z.enum(['run-review', 'pre-detach', 'manual'])

const lane_ledger_pinned_origin = { pinned_origin_schema }

export { lane_ledger_pinned_origin }
