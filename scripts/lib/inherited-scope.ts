import { AsyncLocalStorage } from 'node:async_hooks'
import type { z } from 'zod'
import { json_value } from './json-value'

interface InheritedScope<T> {
	current: () => T | undefined
	local: () => T | undefined
	within: <R>(value: T, run: () => Promise<R>) => Promise<R>
	environment: () => Record<string, string>
}

function storage(key: string): AsyncLocalStorage<unknown> {
	const symbol = Symbol.for(key)
	const existing: unknown = Reflect.get(globalThis, symbol)
	const scope = existing instanceof AsyncLocalStorage ? existing : new AsyncLocalStorage<unknown>()

	Reflect.set(globalThis, symbol, scope)

	return scope
}

// Ship laps and startup telemetry share inheritance; bundled command copies share the symbol.
function create<T>(key: string, schema: z.ZodType<T>): InheritedScope<T> {
	const scope = storage(key)

	function local(): T | undefined {
		return schema.safeParse(scope.getStore()).data
	}

	function current(): T | undefined {
		return local() ?? json_value.parse_with(process.env[key] ?? '', schema)
	}

	async function within<R>(value: T, run: () => Promise<R>): Promise<R> {
		return await scope.run(value, run)
	}

	function environment(): Record<string, string> {
		const value = current()

		return value === undefined ? {} : { [key]: JSON.stringify(value) }
	}

	return { current, local, within, environment }
}

const inherited_scope = { create }
export { inherited_scope }
