import { beforeEach } from 'vitest'

// **Fixture writes to the real streams no longer reach the gate's output** (joshuafolkken/kit#2296).
// A unit test that drives a CLI `main`/`run` — `test:declared --match`, `run:review` with a bad
// argument — writes its `match:` / `Usage: josh …` lines straight to `process.stdout` and
// `process.stderr`, which Vitest forwards from the worker verbatim. Those lines then sat at the tail
// of `pnpm josh test:unit`, and a run reading the gate with `tail` took them for the suite's own
// output. Silencing the two streams for the body of every test drops them; console.* is untouched, so
// a deliberate debug line still shows, and the restore is a per-test teardown so nothing leaks between
// tests or into Vitest's own reporter.

type WriteFunction = typeof process.stdout.write

interface SavedWrites {
	stdout: WriteFunction
	stderr: WriteFunction
}

function swallow(): true {
	return true
}

// Swaps both streams' `write` for a no-op and returns what was there, so the caller restores exactly
// what it replaced rather than a stream reference captured somewhere else — Vitest wraps these in the
// worker, and that wrapper is what must come back.
function silence_streams(): SavedWrites {
	const saved: SavedWrites = { stdout: process.stdout.write, stderr: process.stderr.write }

	process.stdout.write = swallow
	process.stderr.write = swallow

	return saved
}

function restore_streams(saved: SavedWrites): void {
	process.stdout.write = saved.stdout
	process.stderr.write = saved.stderr
}

// The teardown is returned from `beforeEach` rather than kept in a module binding, so two tests never
// share one saved pair and nothing here writes to a top-level variable from inside a hook. The hook
// registration is the setup file's whole purpose, so its top-level effect is deliberate.
// eslint-disable-next-line unicorn/no-top-level-side-effects
beforeEach(() => {
	const saved = silence_streams()

	return () => {
		restore_streams(saved)
	}
})

const test_stdout_guard = { restore_streams, silence_streams }

export { test_stdout_guard }
