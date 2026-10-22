import { backlog_next_shared } from '#scripts/backlog/backlog-next-shared'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { z } from 'zod'
import type { BoardPlan } from './run-board-layout'
import { run_board_plan } from './run-board-plan'

// `run:board`'s plan read, shared the way the drive's assignment and the arrival probe share
// `josh backlog:next` (joshuafolkken/kit#4558): one read within a minute, keyed by the scope it was
// asked for and the newest event on the run's stream, so a launch, a merge or a park reads again.
// Only a plan that read is kept; a failed read is asked again by the next redraw.
//
// The plan holds maps and sets, which JSON does not, so each is kept as its entries and rebuilt on read.

const PLAN_CACHE: CacheSlot = {
	prefix: 'josh-run-board-plan-',
	ttl_ms: backlog_next_shared.NEXT_CACHE.ttl_ms,
}

type EntriesCodec<T, I> = z.ZodCodec<
	z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodType<T, I>], null>>,
	z.ZodReadonly<z.ZodMap<z.ZodNumber, z.ZodCustom<T, T>>>
>

// The value is checked once, on the entries side: a value that is itself a codec would otherwise be
// encoded twice, by the map and again by its entries.
function map_of<T, I>(value: z.ZodType<T, I>): EntriesCodec<T, I> {
	const entries = z.array(z.tuple([z.number(), value]))
	const map = z.map(z.number(), z.custom<T>()).readonly()

	return z.codec(entries, map, {
		decode: (pairs) => new Map(pairs),
		encode: (pairs) => [...pairs],
	})
}

const number_set = z.codec(z.array(z.number()), z.set(z.number()).readonly(), {
	decode: (numbers) => new Set(numbers),
	encode: (numbers) => [...numbers],
})

// A listing cut short knows no open issues (`PlanContext.open_numbers`); JSON drops an `undefined`
// key, so the set is kept inside an object that is always written.
const optional_numbers = z.array(z.number()).optional()
const unknown_or_set = z.codec(
	z.object({ numbers: optional_numbers }),
	z.custom<ReadonlySet<number> | undefined>(),
	{
		decode: ({ numbers }) => (numbers === undefined ? undefined : new Set(numbers)),
		encode: (numbers) => (numbers === undefined ? {} : { numbers: [...numbers] }),
	},
)

const string_set = z.codec(z.array(z.string()), z.set(z.string()).readonly(), {
	decode: (values) => new Set(values),
	encode: (values) => [...values],
})

const names = z.array(z.string()).readonly()
const reference_schema = z.object({ repo: z.string(), number: z.number() })

const child_schema = z.object({
	number: z.number(),
	repo: z.string(),
	state: z.enum(['OPEN', 'CLOSED']),
	labels: names,
	blocked_by: z.array(reference_schema).readonly(),
	body: z.string().optional(),
})

const children = z.array(child_schema).readonly()

const waves_schema = z.object({
	waves: z.array(children).readonly(),
	unreached: children,
	running: children.exactOptional(),
})

const context_schema = z.object({
	repo: z.string(),
	titles: map_of(z.string()),
	open_numbers: unknown_or_set,
})

const board_plan_schema = z.object({
	waves: waves_schema,
	tracked: map_of(z.number()),
	context: context_schema,
	labels: map_of(names),
	declared: map_of(string_set).optional(),
	withheld: number_set.optional(),
})

async function read(
	named: NamedPlan,
	read_plan = run_board_plan.read_plan,
): Promise<BoardPlan | undefined> {
	const key = await backlog_next_shared.stream_key({ board: named })
	const now_ms = Date.now()
	const kept = shared_cache.read(PLAN_CACHE, key, board_plan_schema, now_ms)

	if (kept !== undefined) return kept

	const plan = await read_plan(named)

	if (plan !== undefined) {
		shared_cache.write(PLAN_CACHE, key, board_plan_schema.encode(plan), now_ms)
	}

	return plan
}

const run_board_plan_shared = { PLAN_CACHE, read }

export { run_board_plan_shared }
