#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { test_declared_changed } from './test-declared-changed'
import { test_declared_logic, type Verdict } from './test-declared-logic'

// `josh test:declared` — prints one of `required` / `exempt` / `satisfied` to stdout from the
// working-tree diff, with the reason on stderr (joshuafolkken/kit#2118). The verdict is
// `test-declared-logic.ts`, the tree read is `test-declared-changed.ts`. This command is the way a
// person confirms the same answer by hand; the refusal itself is delivered by the `test-declared` row
// of `delivered-rules.ts` at the commit stage.

// The word is stdout so a caller can read it alone; the reason — which files, and why — is stderr.
function detail_for(verdict: Verdict, paths: ReadonlyArray<string>): string {
	if (verdict === 'required') {
		return `runtime files with no test: ${test_declared_logic.runtime_files(paths).join(', ')}`
	}

	if (verdict === 'exempt') {
		return `exempt paths: ${test_declared_logic.exempt_files(paths).join(', ')}`
	}

	return 'a test file changed'
}

function report(paths: ReadonlyArray<string>): { detail: string; verdict: Verdict } {
	const verdict = test_declared_logic.verdict_for(paths)

	return { detail: detail_for(verdict, paths), verdict }
}

function run(): void {
	const { detail, verdict } = report(test_declared_changed.read_changed_paths_sync())

	process.stdout.write(`${verdict}\n`)
	process.stderr.write(`${detail}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	run()
}

const test_declared = { detail_for, report, run }

export { test_declared }
