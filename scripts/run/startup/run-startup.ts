import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_ledger_kind } from '#scripts/lane/lane-ledger-kind'
import { inherited_scope } from '#scripts/lib/inherited-scope'
import { run_startup_schema, type StartupEntry, type StartupScope } from './run-startup-schema'
import { run_startup_store } from './run-startup-store'

const ENVIRONMENT_KEY = 'JOSH_STARTUP_SCOPE'
const scope = inherited_scope.create(ENVIRONMENT_KEY, run_startup_schema.scope_schema)

interface PhaseOptions<T> {
	issue?: string
	root?: boolean
	edge_of?: (value: T) => 'done' | 'failed' | 'waiting'
}

// A missing or failed measurement never changes the operation's result or error.
async function record(row: StartupEntry): Promise<void> {
	try {
		await run_startup_store.record(row, scope.current()?.destination)
	} catch {
		// Reporting is best effort, including test or extension sinks.
	}
}

function entry(current: StartupScope, name: string, edge: StartupEntry['edge']): StartupEntry {
	return run_startup_schema.entry_schema.parse({
		...current,
		kind: lane_ledger_kind.KIND.STARTUP,
		at: new Date().toISOString(),
		at_ms: performance.timeOrigin + performance.now(),
		id: current.span ?? randomUUID(),
		phase: name,
		edge,
	})
}

async function completed<T>(
	name: string,
	run: () => Promise<T>,
	options: PhaseOptions<T>,
): Promise<T> {
	const current = scope.current()
	if (current === undefined) return await run()
	const started = performance.now()

	await record(entry(current, name, 'start'))
	const ending: { edge: StartupEntry['edge'] } = { edge: 'failed' }

	try {
		const value = await run()

		ending.edge = options.edge_of?.(value) ?? 'done'

		return value
	} finally {
		await record({ ...entry(current, name, ending.edge), elapsed_ms: performance.now() - started })
	}
}

async function current_scope<T>(options: PhaseOptions<T>): Promise<StartupScope | undefined> {
	return (
		scope.current() ??
		(options.root === true ? await run_startup_store.identity(options.issue) : undefined)
	)
}

async function phase<T>(
	name: string,
	run: () => Promise<T>,
	options: PhaseOptions<T> = {},
): Promise<T> {
	const current = await current_scope(options)
	if (current === undefined) return await run()
	const next = {
		...current,
		parent: current.span,
		span: randomUUID(),
		...(options.issue !== undefined && { issue: options.issue }),
	}

	return await scope.within(next, async () => await completed(name, run, options))
}

// Metrics are individual append-only rows, attributed to the innermost span even during parallel work.
function metric(edge: 'api' | 'cache', name: string, key?: string): void {
	const current = scope.current()
	if (current === undefined) return
	void record({
		...entry(current, '', edge),
		metric: name,
		...(key !== undefined && { key: stamp_file.digest(key) }),
	})
}

async function waiting(name: string): Promise<() => Promise<void>> {
	const current = scope.current()
	const started = performance.now()
	const place = { ...current, span: randomUUID(), parent: current?.span }
	if (current !== undefined) await record(entry({ ...current, ...place }, name, 'start'))

	return async (): Promise<void> => {
		if (current === undefined) return
		await record({
			...entry({ ...current, ...place }, name, 'waiting'),
			elapsed_ms: performance.now() - started,
		})
	}
}

const run_startup = {
	ENVIRONMENT_KEY,
	phase,
	metric,
	waiting,
	environment: scope.environment,
	within: scope.within,
}
export { run_startup }
