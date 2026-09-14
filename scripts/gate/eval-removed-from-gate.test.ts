import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1922: `josh eval` became a manual command and the automated rule-compliance
// measurement left the completion gate and every workflow procedure. The distributed documents the
// acceptance criterion names — `CLAUDE.md`, `prompts/**`, `.claude/skills/**` — must carry no step
// that tells a run to query eval, and the manual command must still be documented in `docs/eval.md`.

const ROOT = process.cwd()
const RESIDENT_DOC = 'CLAUDE.md'
const FLOW_TREES: ReadonlyArray<string> = ['.claude/skills', 'prompts']

// The two spellings a "run queries eval" step takes: the trigger command and its gate document. Both
// are gone. The bare `eval` command (still run by hand) is not one of these and is left untouched.
const REMOVED_MARKERS: ReadonlyArray<string> = ['eval:scope', 'eval-gate']

function markdown_files(relative_directory: string): ReadonlyArray<string> {
	return readdirSync(path.join(ROOT, relative_directory), { recursive: true })
		.map(String)
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => path.join(relative_directory, entry))
}

const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	RESIDENT_DOC,
	...FLOW_TREES.flatMap((tree) => markdown_files(tree)),
]

describe('the eval query step is gone from the distributed documents', () => {
	it.each(FLOW_DOCUMENTS)('%s names neither eval:scope nor eval-gate', (relative_path) => {
		const content = readFileSync(path.join(ROOT, relative_path), 'utf8')

		for (const marker of REMOVED_MARKERS) expect(content).not.toContain(marker)
	})
})

describe('the manual josh eval command survives', () => {
	it('docs/eval.md still documents running the suite by hand', () => {
		expect(readFileSync(path.join(ROOT, 'docs/eval.md'), 'utf8')).toContain('pnpm josh eval')
	})
})
