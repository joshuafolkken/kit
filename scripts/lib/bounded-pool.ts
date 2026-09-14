// One definition of "run these at most N at a time".
//
// Three callers need it and had it three times: `eval-run.ts` runs one real Claude session per
// scenario and must not fan out to as many as the suite happens to hold, and `epic-bundle-cli.ts`
// and `epic-bundle-referenced.ts` each read one issue per reference and must not turn a rate limit
// into a wrong answer. The reads were written as waves — slice, `Promise.all`, next slice — which
// idles the whole batch behind its slowest member, so the three were neither the same code nor the
// same behavior (joshuafolkken/kit#1144).
//
// A worker pool instead: `limit` consumers pull from one queue, so a slot is refilled the moment its
// task ends rather than when its neighbors do.

interface IndexedResult<Result> {
	index: number
	value: Result
}

// The queue and what has come out of it, shared by every consumer. Carried as one object rather than
// three captured variables so a consumer can live outside the function that built them.
interface Pool<Item, Result> {
	queue: Array<[number, Item]>
	results: Array<IndexedResult<Result>>
	failures: Array<unknown>
}

// At least one consumer, never more than there is work for. A limit above the item count would spawn
// consumers that find an empty queue and exit; a limit below one would spawn none and return an empty
// result for a non-empty input, which reads as "nothing to do" rather than as the misconfiguration it
// is.
//
// **`NaN` is that same hole, and `Math.max` does not close it**: every comparison with `NaN` is false,
// so the clamp passes it straight through and `Array.from({ length: NaN })` builds no consumer at all
// — an empty result for a non-empty input, which is precisely what the paragraph above promises
// cannot happen. A caller reading that promise is entitled not to validate first, so it is closed
// here (joshuafolkken/kit#1144). A fractional limit is floored for the same reason: `Array.from`
// truncates it silently, and a width that is not the number asked for should be a decision rather
// than a side effect.
function pool_width(limit: number, total: number): number {
	if (!Number.isFinite(limit)) return 1

	return Math.max(1, Math.min(Math.floor(limit), total))
}

// The first failure, once the pool has emptied. `undefined` is a legitimate thing for a worker to
// throw, so the count decides whether there was one rather than the value.
function throw_first_failure(failures: ReadonlyArray<unknown>): void {
	if (failures.length === 0) return

	const [first] = failures

	throw first
}

// One consumer: take the next item, run it, take the next. **A failure recorded by any consumer ends
// every consumer's loop**, so none picks up new work — the serial loop this replaces stopped at the
// first throw, and a pool that kept draining would spawn real Claude sessions after the run had
// already failed. It is recorded rather than thrown because a rejection propagates while the siblings
// are still mid-task, which in the eval suite reaches `eval-run.ts`'s top-level await and ends the
// process before their `finally { remove_sandbox() }` runs — leaking exactly the tree the sandbox
// promises to clean up.
async function drain<Item, Result>(
	pool: Pool<Item, Result>,
	worker: (item: Item, index: number) => Promise<Result>,
): Promise<void> {
	for (
		let entry = pool.queue.shift();
		entry !== undefined && pool.failures.length === 0;
		entry = pool.queue.shift()
	) {
		const [index, item] = entry

		try {
			pool.results.push({ index, value: await worker(item, index) })
		} catch (error) {
			pool.failures.push(error)
		}
	}
}

// Results come back in input order however they finished. Callers pair them with their inputs by
// position — an epic's children are reported in the order its body lists them — so completion order
// must not leak into the array. A failure is raised only after the last consumer has returned, for
// the reason `drain` gives above.
async function bounded_map<Item, Result>(
	items: ReadonlyArray<Item>,
	limit: number,
	worker: (item: Item, index: number) => Promise<Result>,
): Promise<Array<Result>> {
	const pool: Pool<Item, Result> = {
		failures: [],
		queue: items.map((item, index): [number, Item] => [index, item]),
		results: [],
	}
	const consumers = Array.from({ length: pool_width(limit, items.length) }, async () => {
		await drain(pool, worker)
	})

	await Promise.all(consumers)

	throw_first_failure(pool.failures)

	return pool.results
		.toSorted((left, right) => left.index - right.index)
		.map((result) => result.value)
}

const bounded_pool = { bounded_map, pool_width }

export { bounded_pool }
