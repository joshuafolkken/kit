import { ports } from '#ports'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const AUTH_URL_VARIABLE = 'BETTER_AUTH_URL'
// Derived, not restated: an empty environment is exactly the CI condition — no `.env`, so no
// `PORT_SEED` — so this follows `PREVIEW_PORT_BASE`. Hard-coding 4173 here would let a change to
// that base leave both workflows and this guard agreeing on a port the preview server no longer
// binds, which is the drift the guard exists to catch rather than reproduce.
const PREVIEW_URL = `http://localhost:${String(ports.resolve_preview_port({}))}`
const E2E_JOB = 'e2e'
// The stale reference this guard exists to keep out: the comment used to tell the reader to match
// a `PREVIEW_PORT` constant in `playwright.config.ts`, which stopped being a fixed 4173 when the
// port became `PORT_SEED`-derived (kit#818 / #820 / #826). Naming a constant that no longer pins
// the number sends whoever changes this job looking for an invariant that is not there (#832).
const STALE_CONSTANT_REFERENCE = 'PREVIEW_PORT'
// What actually holds the number at 4173 in CI: the seed is not committed and not set here.
const SEED_VARIABLE = 'PORT_SEED'
const ENV_FILE = '.env'
// The comment used to name a repository or organization variable as something that would move the
// port. Neither reaches a step's environment on its own — only an explicit `vars.` expression
// brings one in, and neither workflow writes any — so the sentence described a setting that
// cannot have the effect it warned about (joshuafolkken/kit#838). Naming both the mechanism that
// does work and the reference form that the other one needs is what keeps the correction from
// being reworded back into the original claim.
const WORKING_MECHANISM = 'workflow or job level'
const VARIABLE_REFERENCE_FORM = 'vars.'

const COMMENT_PREFIX = '#'
const ENV_BLOCK_KEY = 'env:'
// A job key sits at two spaces; anything deeper belongs to that job. `String#repeat` rather than
// literal runs of spaces, which lint reads as an accident.
const JOB_INDENT_WIDTH = 2
const JOB_INDENT = ' '.repeat(JOB_INDENT_WIDTH)
const NESTED_INDENT = ' '.repeat(JOB_INDENT_WIDTH + 1)
const NOT_FOUND = -1

const WORKFLOWS: ReadonlyArray<string> = [
	ci_yml_fixture.TEMPLATE_CI_YML,
	ci_yml_fixture.RUNTIME_CI_YML,
]

// The `e2e` job's own lines. Scoping to the job is what keeps a workflow-wide `BETTER_AUTH_URL` —
// exactly the value this comment says not to inherit — from being the line the guard reads.
function e2e_job_lines(relative_path: string): Array<string> {
	const lines = ci_yml_fixture.read_workflow(relative_path).split('\n')
	const start = lines.findIndex((line) => line.startsWith(`${JOB_INDENT}${E2E_JOB}:`))
	if (start === NOT_FOUND) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex(
		(line) => line.startsWith(JOB_INDENT) && !line.startsWith(NESTED_INDENT),
	)

	return end === NOT_FOUND ? rest : rest.slice(0, end)
}

// The contiguous comment run directly above the declaration, with only the `env:` key allowed in
// between. Requiring adjacency is the point: a search that skipped arbitrary lines would find some
// other job's comment once the rationale is deleted, and the guard below would pass vacuously on
// text that has nothing to do with this URL.
function comment_run_above(lines: ReadonlyArray<string>, declaration: number): Array<string> {
	const comment: Array<string> = []

	for (const line of lines.slice(0, declaration).toReversed()) {
		const text = line.trim()
		if (text.startsWith(COMMENT_PREFIX)) comment.unshift(text)
		else if (text !== ENV_BLOCK_KEY) return comment
	}

	return comment
}

// The rationale is a comment, so it survives only in the raw file — the parsed workflow drops it.
// A whole-file `not.toContain('PREVIEW_PORT')` would also fire on the `PREVIEW_PORT=$(josh port
// preview)` shape this very comment recommends, which is the second reason to read a scoped block.
function auth_url_comment(relative_path: string): string {
	const lines = e2e_job_lines(relative_path)
	// Anchored on the declaration, not on any mention: a comment naming the key with a colon would
	// otherwise move the anchor and shrink the block the assertions below read.
	const declaration = lines.findIndex((line) =>
		line.trimStart().startsWith(`${AUTH_URL_VARIABLE}:`),
	)
	if (declaration === NOT_FOUND) return ''

	return comment_run_above(lines, declaration).join('\n')
}

function e2e_auth_url(relative_path: string): string | undefined {
	return ci_yml_fixture.find_job(relative_path, E2E_JOB)?.env?.[AUTH_URL_VARIABLE]
}

describe('ci.yml e2e BETTER_AUTH_URL rationale', () => {
	it.each(WORKFLOWS)('%s explains the 4173 without a PREVIEW_PORT constant', (relative_path) => {
		const comment = auth_url_comment(relative_path)

		expect(comment).not.toBe('')
		expect(comment).not.toContain(STALE_CONSTANT_REFERENCE)
	})

	it.each(WORKFLOWS)('%s states why the seed never reaches CI', (relative_path) => {
		const comment = auth_url_comment(relative_path)

		expect(comment).toContain(SEED_VARIABLE)
		expect(comment).toContain(ENV_FILE)
		expect(comment).toContain('not committed')
	})

	it.each(WORKFLOWS)('%s names only settings that can move the port', (relative_path) => {
		const comment = auth_url_comment(relative_path)

		expect(comment).toContain(WORKING_MECHANISM)
		expect(comment).toContain(VARIABLE_REFERENCE_FORM)
	})
})

// The reword is comment-only: Better Auth rejects the origin unless this names the preview server
// the suite actually talks to, so the value has to survive every edit to the rationale — in kit's
// own workflow as well as in the copy consumers receive.
describe('ci.yml e2e BETTER_AUTH_URL value', () => {
	it.each(WORKFLOWS)('%s overrides the production URL with the unseeded preview URL', (path) => {
		expect(e2e_auth_url(path)).toBe(PREVIEW_URL)
	})
})
