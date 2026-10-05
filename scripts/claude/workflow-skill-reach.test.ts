import { read_repo_file, skill_documents } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { read_skill_file, SKILL_ENTRY_FILE } from './skill-fixture'

// joshuafolkken/kit#3174: the entry file is a manifest of triggers and pointers, so a supporting file
// is reached through the document that routes to it — a command manifest or a single source — rather
// than named by the entry itself. A supporting file no pointer reaches is a file no run opens: the
// skill would ship the rule and still behave as though it had been deleted.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'

function basename_of(file_path: string): string {
	return file_path.split('/').at(-1) ?? file_path
}

function by_text(left: string, right: string): number {
	return left.localeCompare(right)
}

// Followed to a fixed point from the entry's own text: each pass adds every document a reached text
// names, until a pass adds nothing.
function reached_documents(entry: string, documents: ReadonlyMap<string, string>): Set<string> {
	const reached = new Set<string>()
	const texts = [entry]
	let is_growing = true

	while (is_growing) {
		const next = [...documents].filter(
			([name]) => !reached.has(name) && texts.some((text) => text.includes(name)),
		)

		for (const [name, text] of next) {
			reached.add(name)
			texts.push(text)
		}

		is_growing = next.length > 0
	}

	return reached
}

function supporting_documents(): Map<string, string> {
	const paths = skill_documents().filter(
		(path) => path.startsWith(`${WORKFLOW_SKILL}/`) && !path.endsWith(SKILL_ENTRY_FILE),
	)

	return new Map(paths.map((path) => [basename_of(path), read_repo_file(path)]))
}

describe(`${WORKFLOW_SKILL} — every shipped document is reachable`, () => {
	it('reaches every markdown file it ships from the entry file', () => {
		const documents = supporting_documents()
		const reached = reached_documents(read_skill_file(WORKFLOW_SKILL), documents)

		expect([...reached].toSorted(by_text)).toEqual([...documents.keys()].toSorted(by_text))
	})

	it('does not count a document no reached text names', () => {
		const documents = new Map([
			['named.md', 'no further pointer'],
			['orphan.md', 'never named'],
		])

		expect([...reached_documents('see `named.md`', documents)]).toEqual(['named.md'])
	})
})
