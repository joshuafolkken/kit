import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_rule_surface,
	rule_surface_documents,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'

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

// kit#854 moved the procedure into the `dependency-update` skill and left the two prohibitions
// resident, so the markers split: the ones above stay in the document, while the steps that re-state
// the check now live in the skills the document routes to. Both halves are still asserted — a step
// naming the wrong file is the same defect wherever it is written.
const VERIFY_PHRASE = 'verify the overrides'

// Read as a window of following text rather than as the rest of the physical line: prose in these
// files is hard-wrapped, so a line-based check would pass or fail on where a paragraph happens to
// break, and re-wrapping one sentence would silently retire the assertion.
const RESTATEMENT_WINDOW = 160

function restatements_in(text: string): ReadonlyArray<string> {
	const lowered = text.toLowerCase()
	const windows: Array<string> = []
	let index = lowered.indexOf(VERIFY_PHRASE)

	while (index !== -1) {
		windows.push(text.slice(index, index + RESTATEMENT_WINDOW))
		index = lowered.indexOf(VERIFY_PHRASE, index + VERIFY_PHRASE.length)
	}

	return windows
}

// Scanned per file rather than over the concatenation: a restatement near the end of one file would
// otherwise reach into the next, and be satisfied by a file name that belongs to a different rule.
function restatements_of(document_path: string): ReadonlyArray<string> {
	return rule_surface_documents(document_path).flatMap((path) =>
		restatements_in(read_repo_file(path)),
	)
}

describe.each(AI_DOCS)('%s — overrides protection names both locations', (document_path) => {
	const content = read_repo_file(document_path)
	const surface = read_rule_surface(document_path)

	it.each(AI_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('has no verify instruction that names package.json alone', () => {
		expect(SINGLE_FILE_VERIFY.test(surface)).toBe(false)
	})

	it('routes the reader to the skill that owns the procedure', () => {
		expect(content).toContain('load the `dependency-update` skill')
	})

	it('names pnpm-workspace.yaml in every workflow step that re-states the check', () => {
		const steps = restatements_of(document_path)

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
