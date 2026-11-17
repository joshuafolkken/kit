import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The `josh test:related` row, joined into the entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

const full_reach_schema = z.object({ file: z.string(), reached: z.number() })

// One `josh test:related` run (joshuafolkken/kit#4465): `scope` is `related`, `none` or the full-suite
// fallback kind; the four counts are its input — the change itself, what a main sync brought into it,
// what the change since the test-read map's tree joined to it and the map's readers — and `test_files`
// how many vitest ran, absent where none reported. `trigger_files` are the changed files that sent a
// full-suite run there, absent where none did and on rows written before it (joshuafolkken/kit#4510).
const test_related_schema = z.object({
	reused: z.number().optional(),
	reuse_missed: z.number().optional(),
	reuse_reason: z.string().optional(),
	reuse_elapsed_ms: z.number().optional(),
	select_elapsed_ms: z.number().optional(),
	kind: z.literal(KIND.TEST_RELATED),
	at: z.string(),
	issue: z.number().optional(),
	scope: z.string(),
	changed: z.number(),
	synced: z.number(),
	since_map: z.number(),
	readers: z.number(),
	test_files: z.number().optional(),
	trigger_files: z.array(z.string()).optional(),
	// The changed files past the reach cap, run by their direct importers alone (joshuafolkken/kit#5532).
	over_cap: z.number().optional(),
	// The widest of them in the run's own change, the hub that put the run past the cap
	// (joshuafolkken/kit#5699); absent when main or the map's tree brought them all (joshuafolkken/kit#5756).
	over_cap_hub: z.string().optional(),
	// The files past the cap it left at their whole reach, each with that reach, widest first — absent
	// where there were none and on rows written before it (joshuafolkken/kit#7639).
	full_reach: z.array(full_reach_schema).optional(),
	// The changed file that added the most test files to the run, and that number — absent where no
	// reach was read and on rows written before it (joshuafolkken/kit#7735).
	widest_file: z.string().optional(),
	widest_tests: z.number().optional(),
	// The branch change read beside the run, by half and by base (joshuafolkken/kit#6982).
	branch_tracked: z.number().optional(),
	branch_untracked: z.number().optional(),
	branch_base: z.enum(['merge_base', 'fallback']).optional(),
	// `changed` split by whether that branch change holds the file (joshuafolkken/kit#7066).
	changed_in_branch: z.number().optional(),
	changed_off_branch: z.number().optional(),
	elapsed_ms: z.number(),
})

const lane_ledger_schema_related = { test_related_schema }

export { lane_ledger_schema_related }
