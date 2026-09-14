import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { import_closure, SCRIPTS_DIR } from '#scripts/build/import-closure-fixture'
import { describe, expect, it } from 'vitest'

// The distribution boundary (joshuafolkken/kit#1996): the runtime analysis kit distributes —
// everything under `time-runtime/` and `cost-runtime/`, reached by consumers through commands, hooks,
// guards and `josh cost --over` — must never statically import a kit-only measurement report. The
// reports were split into their own directories (`time/`, `cost/`) precisely so this check is a
// directory rule rather than an allow-list: no file the runtime statically pulls in may live there.
//
// The walker itself (static value-imports only, `#scripts/` and relative specifiers resolved against
// `scripts/`) is single-sourced in `import-closure-fixture.ts` and shared with `pack-boundary.test.ts`.

const TIME_RUNTIME = 'time-runtime'
const COST_RUNTIME = 'cost-runtime'
const RUNTIME_DIRS = [TIME_RUNTIME, COST_RUNTIME]
const REPORT_DIRS = ['time', 'cost']
// #1996 seeded only the runtime directories, so a command entry that reaches a report through a
// distributed recorder went unchecked: `followup` records every merged run through
// `time_history.record_run`, and that recorder used to statically pull in the whole report closure
// (joshuafolkken/kit#2003). The command entries are seeded alongside the runtime so their static
// closure is held to the same boundary.
const FOLLOWUP_ENTRY = path.join(SCRIPTS_DIR, '..', 'scripts-ai', 'git-followup-finish.ts')
const COMMAND_ENTRIES = [FOLLOWUP_ENTRY]

function runtime_seed_files(): Array<string> {
	return RUNTIME_DIRS.flatMap((directory) =>
		readdirSync(path.join(SCRIPTS_DIR, directory))
			.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
			.map((entry) => path.join(SCRIPTS_DIR, directory, entry)),
	)
}

// The runtime files plus the distributed command entries that reach the runtime through a recorder.
function seed_files(): Array<string> {
	return [...runtime_seed_files(), ...COMMAND_ENTRIES]
}

function is_report_file(file: string): boolean {
	const relative = path.relative(SCRIPTS_DIR, file)

	return REPORT_DIRS.some((directory) => relative.startsWith(`${directory}${path.sep}`))
}

describe('the distributed runtime closure', () => {
	const closure = import_closure.closure(seed_files())

	it('is walked from a non-empty runtime, reaching its own foundation', () => {
		expect(seed_files().length).toBeGreaterThan(0)
		expect(closure.has(path.join(SCRIPTS_DIR, TIME_RUNTIME, 'time-spans.ts'))).toBe(true)
		expect(closure.has(path.join(SCRIPTS_DIR, COST_RUNTIME, 'cost-corpus.ts'))).toBe(true)
	})

	it('reaches no kit-only report module under time/ or cost/', () => {
		const reached_reports = [...closure]
			.filter((file) => is_report_file(file))
			.map((file) => path.relative(SCRIPTS_DIR, file))

		expect(reached_reports).toEqual([])
	})

	// The path #1996's runtime-only seed missed: `followup` records every merged run through
	// `time_history.record_run`, so its static closure must reach the recorder and yet stay clear of
	// the report directories (joshuafolkken/kit#2003).
	it('walks the followup command entry to the recorder without reaching a report', () => {
		expect(existsSync(FOLLOWUP_ENTRY)).toBe(true)

		const followup_closure = import_closure.closure([FOLLOWUP_ENTRY])

		expect(followup_closure.has(path.join(SCRIPTS_DIR, TIME_RUNTIME, 'time-history.ts'))).toBe(true)
		expect([...followup_closure].filter((file) => is_report_file(file))).toEqual([])
	})
})
