import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

// kit #740: every statement of the overrides protection named `package.json` only, so an agent that
// followed it literally read an absent `pnpm.overrides`, concluded there was nothing to protect,
// and wrote that false all-clear into permanent artifacts — while the real override sat in
// pnpm-workspace.yaml. A rule that verifies the wrong file passes in exactly the state it exists to
// detect, so the file name and the "empty is not absent" caveat have to survive in every copy.

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const DIFF_COMMAND = 'git diff -- pnpm-workspace.yaml package.json'

// Naming the file is the minimum; without the caveat an agent still reads `pnpm.overrides`, finds
// it empty, and treats that as the answer.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)',
	"**Overrides live in two files, and one of them alone is not the project's answer.**",
	'is not evidence that the project has no overrides',
	'a verdict that names only `package.json` has not checked anything',
	'**The check is a command you run, not a conclusion you reach.**',
	DIFF_COMMAND,
]

const WORKFLOW_MARKERS: ReadonlyArray<string> = [
	'### overrides の保護（`pnpm-workspace.yaml` / `package.json` の両方を見る）',
	'overrides は 2 箇所に置かれ、片方だけを見ても答えにならない',
	'そのプロジェクトに overrides が無いことの証拠にはならない',
	DIFF_COMMAND,
	'実際に出力された行を引用して報告する',
]

// The workflow steps repeat the check inline; a step still saying "verify `pnpm.overrides`" would
// send an agent back to the single wrong file no matter how the dedicated section reads.
const SINGLE_FILE_VERIFY = /verify `pnpm\.overrides`/iu

describe.each(AI_DOCS)('%s — overrides protection names both locations', (document_path) => {
	const content = read_repo_file(document_path)

	it.each(AI_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('has no verify instruction that names package.json alone', () => {
		expect(SINGLE_FILE_VERIFY.test(content)).toBe(false)
	})

	it('names pnpm-workspace.yaml in every workflow step that re-states the check', () => {
		const steps = content.split('\n').filter((line) => line.includes('verify the overrides'))

		expect(steps.length).toBeGreaterThan(0)
		for (const step of steps) expect(step).toContain(WORKSPACE_YAML)
	})
})

describe(`${WORKFLOW_PROMPT} — canonical overrides section`, () => {
	const content = read_repo_file(WORKFLOW_PROMPT)

	it.each(WORKFLOW_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
