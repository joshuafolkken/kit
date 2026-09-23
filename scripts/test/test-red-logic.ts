import { markdown_section } from '#scripts/issue/markdown-section'
import { z } from 'zod'
import { test_declared_logic } from './test-declared-logic'

// The verdict `josh test:red` prints, and the Issue declaration that makes `josh git -y` ask for it
// (joshuafolkken/kit#2448).
//
// **A regression test that is green on the pre-fix tree does not reproduce the reported symptom.**
// joshuafolkken/kit#2308 closed with a test that never went red, and joshuafolkken/kit#2393 was the
// same symptom back. `josh test:declared` only answers whether a test was added; this answers whether
// that test catches anything — the added and changed tests run against the merge-base, and at least one
// of them has to fail there.

type RedVerdict = 'red' | 'green' | 'no-test'

// The declaration a bug-fix Issue carries under its background heading, in the same slot as the
// behavior-change declaration (`behavior-change-lint.ts`). Read from the declaration, never inferred,
// so an Issue that does not declare itself a bug is never held to it.
const BUG_DECLARATION_LINE = '- 種別: 不具合'

// Only a Vitest file can be run against the pre-fix tree here — an `*.e2e.ts` needs a served app, so it
// is left to the CI E2E job rather than counted as a test this command ran.
const UNIT_TEST_SUFFIX = '.test.ts'

function is_bug_fix(body: string): boolean {
	return markdown_section.has_line(body, BUG_DECLARATION_LINE)
}

// The changed paths that are Vitest files, in the order they were given.
function unit_test_files(paths: ReadonlyArray<string>): Array<string> {
	return paths
		.map((path) => path.trim())
		.filter((path) => test_declared_logic.is_test_file(path) && path.endsWith(UNIT_TEST_SUFFIX))
}

// Vitest's JSON report carries one `testResults` entry per file it loaded — a file that failed to load
// included — and none for a file its config excluded, so this is how many files actually ran. The
// changed-path count cannot stand in for it: a file the merge-base config does not include runs nothing
// and exits 0, which would read as `green` and refuse a correct fix. An unreadable report counts zero.
const REPORT_SCHEMA = z.object({ testResults: z.array(z.unknown()) })

function ran_file_count(report: string): number {
	try {
		const parsed = REPORT_SCHEMA.safeParse(JSON.parse(report))

		return parsed.success ? parsed.data.testResults.length : 0
	} catch {
		return 0
	}
}

// `no-test` when nothing ran; otherwise a failing run is `red` — the test caught the pre-fix tree — and
// a passing one is `green`.
function verdict_for(test_count: number, is_failed: boolean): RedVerdict {
	if (test_count === 0) return 'no-test'

	return is_failed ? 'red' : 'green'
}

// Only `green` on a declared bug fix is refused. `no-test` is already `josh test:declared`'s refusal
// when a runtime file changed, and a declared fix that touched only docs has nothing to reproduce.
function is_refused(body: string, verdict: RedVerdict): boolean {
	return verdict === 'green' && is_bug_fix(body)
}

const test_red_logic = {
	BUG_DECLARATION_LINE,
	is_bug_fix,
	is_refused,
	ran_file_count,
	unit_test_files,
	verdict_for,
}

export type { RedVerdict }
export { test_red_logic }
