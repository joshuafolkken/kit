import { existsSync } from 'node:fs'
import {
	PROMPT_ROOT,
	read_index,
	read_repo_file,
	routing_documents,
	WORKFLOW_PROMPT_DIRECTORY,
	workflow_prompt_files,
} from '#scripts/ai-document-fixture'
import { package_file } from '#scripts/skill-fixture'
import { describe, expect, it } from 'vitest'

// The canonical workflow document used to be one 169 KB file, and every pointer into it named a
// section — so consulting one topic meant reading all of them, and paying for all of them on every
// remaining turn of the session. joshuafolkken/kit#965 split it into one file per topic and left
// the old path as an index.
//
// What can silently rot after a split is the pointers: a renamed topic file leaves a citation
// resolving to nothing, and nothing else in the suite would notice. This is the guard.

const INDEX = 'prompts/collaboration-workflow.md'
const CITATION_PATTERN = /`prompts\/collaboration-workflow\/([a-z0-9-]+\.md)`/gu
// The index exists to be read instead of the corpus, so it has to stay far smaller than it.
const INDEX_CEILING_BYTES = 8000

// The fixture already enumerates them for the concatenating reader; re-implementing it here would
// let the two drift and quietly stop covering a file the reader still concatenates.
function topic_files(): ReadonlyArray<string> {
	return workflow_prompt_files().map((path) => path.slice(`${WORKFLOW_PROMPT_DIRECTORY}/`.length))
}

// Every file that routes a reader into the split, not only the AI documents and the skills. The
// first version of this list stopped at those two, which left the citations in `prompts/review.md`
// and `docs/josh-commands.md` — added by the very change this suite guards — unchecked. The set
// itself is the fixture's, shared with the pointer-citation suite so a root cannot drop out of one.
//
// The topic files themselves are excluded here: a cross-reference between two of them is checked by
// the same rule, but the index is read raw elsewhere and would double-count.
function citing_documents(): ReadonlyArray<string> {
	const topics = `${PROMPT_ROOT}/collaboration-workflow/`

	return routing_documents().filter((path) => !path.startsWith(topics) && path !== INDEX)
}

// The index lists its topics as markdown links, not as paths in backticks, so the citation pattern
// used everywhere else finds only whatever path happens to sit in its code fence.
const INDEX_ROW_PATTERN = /\]\(\.\/collaboration-workflow\/([a-z0-9-]+\.md)\)/gu

function index_citations(): ReadonlyArray<string> {
	const found: Array<string> = []

	for (const match of read_index().matchAll(INDEX_ROW_PATTERN)) {
		if (match[1] !== undefined) found.push(match[1])
	}

	return found
}

function citations_in(document_path: string): ReadonlyArray<string> {
	const found: Array<string> = []

	for (const match of read_repo_file(document_path).matchAll(CITATION_PATTERN)) {
		if (match[1] !== undefined) found.push(match[1])
	}

	return found
}

describe('the canonical workflow document is split by topic', () => {
	it('ships more than one topic file', () => {
		expect(topic_files().length).toBeGreaterThan(1)
	})

	it('keeps the index far smaller than the corpus it indexes', () => {
		const index = Buffer.byteLength(read_index(), 'utf8')

		expect(index).toBeLessThan(INDEX_CEILING_BYTES)
	})

	// The reason for the split, stated where the next editor will read it.
	it('says the index is not what an agent reads during a run', () => {
		expect(read_index()).toContain('実行中の参照先ではない')
	})

	it.each(topic_files())('is listed in the index — %s', (file_name) => {
		expect(read_index()).toContain(`(./collaboration-workflow/${file_name})`)
	})

	it('lists nothing in the index that does not exist', () => {
		for (const cited of index_citations()) {
			expect(topic_files()).toContain(cited)
		}
	})
})

// A citation may name a section as well as a file: `` `…/epicrun.md` → "EPIC でない Issue も受け取る" ``.
// Checking only that the file exists is what let three pointers name the wrong file and stay green —
// the files existed, the sections were in other ones (joshuafolkken/kit#965).
// Both quote styles: the documents use `"…"` and `「…」` interchangeably, and matching only the
// ASCII pair left three of CLAUDE.md's citations unchecked — including the ones this change added.
const SECTION_CITATION_PATTERN =
	/`prompts\/collaboration-workflow\/([a-z0-9-]+\.md)`\s*→\s*(?:"([^"]+)"|「([^」]+)」)/gu

interface SectionCitation {
	file: string
	section: string
}

function section_citations_in(document_path: string): ReadonlyArray<SectionCitation> {
	const found: Array<SectionCitation> = []

	for (const match of read_repo_file(document_path).matchAll(SECTION_CITATION_PATTERN)) {
		const section = match[2] ?? match[3]

		if (section !== undefined && match[1] !== undefined) {
			found.push({ file: match[1], section })
		}
	}

	return found
}

describe.each(citing_documents())('%s — its named sections resolve', (document_path) => {
	const cited = section_citations_in(document_path)

	it.each(cited.length === 0 ? [['(none)', '']] : cited.map((one) => [one.file, one.section]))(
		'%s contains the section it is cited for — %s',
		(file_name, section) => {
			if (file_name === '(none)') return

			const body = read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file_name}`)

			expect(body).toContain(section)
		},
	)
})

describe.each(citing_documents())('%s — its canonical citations resolve', (document_path) => {
	const cited = citations_in(document_path)

	it.each(cited.length === 0 ? [['(none)']] : cited.map((file) => [file]))(
		'points at a file that exists — %s',
		(file_name) => {
			if (file_name === '(none)') return

			expect(existsSync(package_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file_name}`))).toBe(true)
		},
	)
})

// Deliberately excludes the index. Every topic title also appears in the index's table, so a suite
// that searched the index too would pass with every topic file emptied — which is what the first
// version of this suite did.
describe('the split lost nothing', () => {
	const topics = topic_files()
		.map((file) => read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file}`))
		.join('\n')

	// One body sentence from each of four different original sections, each verified absent from the
	// index — a marker the index also carries would pass however empty the topic file became.
	it.each([
		'9. 検証ゲート（`CLAUDE.md` の Completion gate）を実行する',
		'そのため `epicrun #<N>` の実行中に前提 Issue または分割が判明しても、**停止しない**。',
		'overrides に設定された制約は、**セキュリティ・互換性・動作保証のために意図的に追加されたもの**である。',
	])('keeps %j in a topic file, not only in the index', (marker) => {
		expect(topics).toContain(marker)
		expect(read_index()).not.toContain(marker)
	})

	it.each(topic_files())('%s is more than a heading', (file_name) => {
		const body = read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file_name}`)
		const filled = body.split('\n').filter((line) => line.trim() !== '')

		expect(filled.length).toBeGreaterThan(1)
	})
})
