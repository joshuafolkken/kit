import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { import_closure, SCRIPTS_DIR, TOOLS_DIR } from '#scripts/build/import-closure-fixture'
import { describe, expect, it, onTestFinished } from 'vitest'

// The distribution boundary (joshuafolkken/kit#1996): the runtime analysis kit distributes —
// everything under `time-runtime/` and `cost-runtime/`, reached by consumers through commands, hooks,
// guards and `josh cost --over` — must never statically import a kit-only module. Kit-only code lives
// in `tools/` (joshuafolkken/kit#4149), the measurement reports `tools/time/` and `tools/cost/`
// included, so this check is a directory rule rather than an allow-list: no file the runtime
// statically pulls in may live there.
//
// The walker itself (static value-imports only, `#scripts/`, `#tools/` and relative specifiers
// resolved by location) is single-sourced in `import-closure-fixture.ts` and shared with
// `pack-boundary.test.ts`.

const TIME_RUNTIME = 'time-runtime'
const COST_RUNTIME = 'cost-runtime'
const RUNTIME_DIRS = [TIME_RUNTIME, COST_RUNTIME]

// The runtime files distributed to consumers, reached through commands, hooks, guards and
// `josh cost --over`.
function seed_files(): Array<string> {
	return RUNTIME_DIRS.flatMap((directory) =>
		readdirSync(path.join(SCRIPTS_DIR, directory))
			.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
			.map((entry) => path.join(SCRIPTS_DIR, directory, entry)),
	)
}

function is_kit_only_file(file: string): boolean {
	return file.startsWith(`${TOOLS_DIR}${path.sep}`)
}

describe('the distributed runtime closure', () => {
	const closure = import_closure.closure(seed_files())

	it('is walked from a non-empty runtime, reaching its own foundation', () => {
		expect(seed_files().length).toBeGreaterThan(0)
		expect(closure.has(path.join(SCRIPTS_DIR, TIME_RUNTIME, 'time-spans.ts'))).toBe(true)
		expect(closure.has(path.join(SCRIPTS_DIR, COST_RUNTIME, 'cost-corpus.ts'))).toBe(true)
	})

	it('reaches no kit-only module under tools/', () => {
		const reached = [...closure]
			.filter((file) => is_kit_only_file(file))
			.map((file) => path.relative(TOOLS_DIR, file))

		expect(reached).toEqual([])
	})
})

describe('the walker this boundary relies on', () => {
	it('follows a #tools/ import into tools/, so a runtime import of one would be caught', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'distribution-boundary-'))
		const seed = path.join(directory, 'runtime.ts')

		onTestFinished(() => {
			rmSync(directory, { recursive: true, force: true })
		})
		writeFileSync(seed, "import { time_cli } from '#tools/time/time-cli'\n")

		const reached = [...import_closure.closure([seed])].filter((file) => is_kit_only_file(file))

		expect(reached).toContain(path.join(TOOLS_DIR, 'time', 'time-cli.ts'))
	})
})
