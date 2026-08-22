import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Two distributed artifacts each depend on a GitHub repository setting kit cannot write, and each
// report must run from every entry point below — which are not interchangeable.
//
// `josh init` and `josh sync` are the moments those artifacts reach the consumer, so they are where
// a missing prerequisite is discoverable at all; `josh doctor` is where a user goes afterwards to
// ask why npm advisories are not arriving (joshuafolkken/kit#805) or why a green Dependabot pull
// request is not merging (joshuafolkken/kit#834). Dropping any one of them restores the silent
// failure the Issues exist to remove — hence a guard rather than a convention.
//
// This asserts the wiring only. What each report decides is verified by running the code in
// `security-updates-logic.test.ts` / `security-updates.test.ts` and
// `auto-merge-setting-logic.test.ts` / `auto-merge-setting.test.ts`.
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))

// Every entry point that writes one of the artifacts, plus the diagnostic a user reaches for
// afterwards. `init` scaffolds them, `sync` updates them, `doctor` explains them.
const CALLERS: ReadonlyArray<{ label: string; file: string }> = [
	{ label: 'josh init', file: 'init/init.ts' },
	{ label: 'josh doctor', file: 'doctor/doctor.ts' },
	{ label: 'josh sync', file: 'sync/sync.ts' },
]

// Calls are matched without their argument lists — the guard is about the call existing, not its
// arity. Every caller goes through the shared section helper of its module, so the separator and the
// ordering contract stay in one place rather than being re-implemented per entry point.
const REPORTS: ReadonlyArray<{ label: string; module_import: string; report_call: string }> = [
	{
		label: 'security-updates',
		module_import: "from '#scripts/security-updates'",
		report_call: 'security_updates.report_security_updates_section(',
	},
	{
		label: 'auto-merge-setting',
		module_import: "from '#scripts/auto-merge-setting'",
		report_call: 'auto_merge_setting.report_auto_merge_section(',
	},
]

// Line comments are stripped before matching: the failure this guard is meant to catch is the call
// disappearing, and commenting it out would otherwise leave the text present and the test green.
function read_caller(file: string): string {
	return readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n')
}

describe('repository setting report wiring', () => {
	for (const { label, module_import, report_call } of REPORTS) {
		for (const caller of CALLERS) {
			it(`${caller.label} imports the ${label} module`, () => {
				expect(read_caller(caller.file)).toContain(module_import)
			})

			it(`${caller.label} calls the ${label} report`, () => {
				expect(read_caller(caller.file)).toContain(report_call)
			})
		}
	}
})
