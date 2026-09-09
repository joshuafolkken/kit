// A promise whose answer is given by the caller (joshuafolkken/kit#1446).
//
// **What it is for**: asking what a run had *already issued* while one request was still outstanding.
// Concurrency is not observable from a duration — a lap measured on a mocked call is not a fact about
// anything — but it is observable from order: hold one answer back, and whatever went out in the
// meantime cannot have been waiting for it. Both suites that pin `followup`'s batched round trips ask
// exactly that question, of different collaborators, so the idiom is single-sourced here rather than
// written twice.
//
// **A `-fixture` name, because it is test scaffolding**: `package.json` excludes `!**/*-fixture.ts`
// from the published `files`, and every other test helper in this directory is named the same way. A
// plain name would ship this to every consumer of the package as dead code reachable through
// `#scripts/*`.
interface DeferredAnswer<T> {
	promise: Promise<T>
	answer: (value: T) => void
}

// **`Promise.withResolvers()` is exactly this**, and `tsconfig.json` pins `lib` to ES2023 — one
// release short of the declaration, though the Node this runs on has the method. Widening `lib`
// changes the type surface of every consumer of the package, which is a decision of its own rather
// than a side effect of a test helper, so the construction is written out here and this file is the
// one place that has to change when that bump happens.
//
// **The resolver is held on an object rather than in a bare `let`**, which is what keeps the
// construction lint-clean without a disable: `init-declarations` wants the binding initialized where
// it is declared, and `unicorn/no-useless-undefined` refuses the `= undefined` that would do it.
function deferred_answer<T>(): DeferredAnswer<T> {
	const held: { resolve_answer?: (value: T) => void } = {}

	const promise = new Promise<T>(function capture(resolve) {
		held.resolve_answer = resolve
	})

	function answer(value: T): void {
		held.resolve_answer?.(value)
	}

	return { promise, answer }
}

export { deferred_answer }
export type { DeferredAnswer }
