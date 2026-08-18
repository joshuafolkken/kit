import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#805: the report must run from every entry point below, and they are not
// interchangeable.
// `josh sync` is the moment the npm version-update disable (kit#803) reaches the consumer, so it is
// where the missing prerequisite is discoverable at all; `josh doctor` is where a user goes to ask
// why something is wrong afterwards. Dropping either one restores the silent failure the Issue
// exists to remove — hence a guard rather than a convention.
//
// This asserts the wiring only. What the report itself decides is verified by running the code in
// `security-updates-logic.test.ts` and `security-updates.test.ts`.
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
// Matched without the argument list — the guard is about the call existing, not its arity. Every
// caller goes through the shared section helper, so the separator and ordering contract stay in one
// place rather than being re-implemented per entry point.
const REPORT_CALL = 'security_updates.report_security_updates_section('
const MODULE_IMPORT = "from '#scripts/security-updates'"

// Every entry point that writes the npm-disabling `.github/dependabot.yml`, plus the diagnostic a
// user reaches for afterwards. `init` scaffolds it, `sync` updates it, `doctor` explains it.
const CALLERS: ReadonlyArray<{ label: string; file: string }> = [
	{ label: 'josh init', file: 'init/init.ts' },
	{ label: 'josh doctor', file: 'doctor/doctor.ts' },
	{ label: 'josh sync', file: 'sync/sync.ts' },
]

// Line comments are stripped before matching: the failure this guard is meant to catch is the call
// disappearing, and commenting it out would otherwise leave the text present and the test green.
function read_caller(file: string): string {
	return readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n')
}

describe('security updates report wiring', () => {
	for (const { label, file } of CALLERS) {
		it(`${label} imports the security-updates module`, () => {
			expect(read_caller(file)).toContain(MODULE_IMPORT)
		})

		it(`${label} calls the security-updates report`, () => {
			expect(read_caller(file)).toContain(REPORT_CALL)
		})
	}
})
