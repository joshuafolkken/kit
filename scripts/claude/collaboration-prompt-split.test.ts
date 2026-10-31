import { existsSync } from 'node:fs'
import {
	PROMPT_ROOT,
	read_index,
	read_repo_file,
	routing_documents,
	WORKFLOW_PROMPT_DIRECTORY,
	workflow_prompt_files,
} from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { package_file } from './skill-fixture'

// Topic files keep workflow reads focused (joshuafolkken/kit#965). Renaming a topic can leave a
// citation unresolved, so this suite checks the index and pointers together.

const INDEX = 'prompts/collaboration-workflow.md'
const CITATION_PATTERN = /`prompts\/collaboration-workflow\/([a-z0-9-]+\.md)`/gu
// The index exists to be read instead of the corpus, so it has to stay far smaller than it.
//
// A share of the corpus was tried for this and is wrong, because the two quantities move in
// opposite directions. The index grows only by table rows — the suite below requires every topic
// file to be listed, so a conversion that splits a section into its own topic file
// (joshuafolkken/kit#1186 is the first) owes it one — while the joshuafolkken/kit#1176 rollout
// shrinks the corpus, each conversion replacing a body with a pointer. A share would fail on a
// conversion that never touched the index.
//
// So the ceiling stays a byte count, and it moves by one full row for each new topic file
// (joshuafolkken/kit#1186, #1524, #1198, #1565, #1584 and #1758 each added one): **what it guards
// against is the index absorbing content**, not a new topic being indexed at all. A topic file
// nothing links to is a file nobody opens, so refusing the row would keep the number green by
// leaving the corpus unreachable. A full row, not the row's own length, so the next topic is not
// decided by how long its title happens to be.
const INDEX_CEILING_BYTES = 9968

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
	it('says the index is not where a rule is defined', () => {
		expect(read_index()).toContain('規則を定める場所ではない')
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

// A citation may name a section as well as a file: `` `…/backlogrun.md` → "When #N is not an epic" ``.
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
	//
	// The sample taken from the `epicrun` section was replaced under joshuafolkken/kit#1188. Its body
	// moved into `.claude/skills/workflow-commands/backlogrun.md` and the topic file became a pointer,
	// which this suite deliberately does not read — so sampling it would have asserted the opposite
	// of what the suite is for. A sentence from a topic that still holds a body took its place.
	// joshuafolkken/kit#2893 did the same for the overrides sample: its body moved into
	// `.claude/skills/dependency-update/SKILL.md`, so a sentence from the body `operating-rules.md`
	// still holds — the CI-failure report — replaced it. joshuafolkken/kit#4188 cut `plan-comment.md`
	// to Step 3, so its sample is now the `kickoff` stop line that Step 3 keeps.
	it.each([
		'`kickoff` はここで**停止**する',
		'ラベルに注釈を付けない。',
		'**完了コメントに失敗を隠してはならない**',
	])('keeps %j in a topic file, not only in the index', (marker) => {
		expect(topics).toContain(marker)
		expect(read_index()).not.toContain(marker)
	})

	// joshuafolkken/kit#2894 merged seven principle files into one and joshuafolkken/kit#3407 added
	// quality-priority; each keeps its own heading so `CLAUDE.md` can cite it by section. Losing one
	// would orphan that citation's rule.
	it.each([
		'## no-clones — クローン禁止・単一ソース化',
		'## elegant-design — 設計はエレガント・シンプルを第一目標にする',
		'## consult-vs-execute — 相談と実行を区別する',
		'## latest-first — 最新優先・fix-forward',
		'## durable-rules — 恒久ルールは MEMORY ではなくプロンプト／ドキュメントに書く',
		'## upstream-to-kit — 配布ドキュメント・設定の変更は kit に上流化する',
		'## エージェント規則の単一ソースは `CLAUDE.md`',
		'## quality-priority — 品質目標が衝突したときの優先順位',
	])('keeps the principle %j as its own section', (heading) => {
		expect(read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/principles.md`)).toContain(heading)
	})

	// joshuafolkken/kit#3407: the priority order is reachable only through its `CLAUDE.md` pointer.
	it('points CLAUDE.md at the quality-priority section', () => {
		expect(read_repo_file('CLAUDE.md')).toMatch(
			/`prompts\/collaboration-workflow\/principles\.md` → [^\n]*"quality-priority"/u,
		)
	})

	it.each(topic_files())('%s is more than a heading', (file_name) => {
		const body = read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file_name}`)
		const filled = body.split('\n').filter((line) => line.trim() !== '')

		expect(filled.length).toBeGreaterThan(1)
	})
})

// joshuafolkken/kit#3428 ranked the four middle goals equal and added the order a conflict among them
// is settled in; losing one of these would bring back a ranking among them.
describe('quality-priority keeps the three tiers and the conflict order', () => {
	it.each([
		'2. **同列で、どれも悪化させない**',
		'**AI コスト**',
		'1. **まず、全部を満たす方法を探す**',
		'2. **1 つを悪くするなら、同じ変更の中で別の場所を削って埋め合わせる**',
		'3. **それでも両立しないときは、数字を示して利用者に聞く**（Tier B）',
		'機能や最適化の追加を止める・凍結する・後回しにする案を出さない。順序は優先度ラベルが決める',
		'進化を続けたまま不具合を防ぐ仕組み（単一ソース化、層の統合、不変条件のテスト）を提案する',
	])('states %j', (marker) => {
		expect(read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/principles.md`)).toContain(marker)
	})

	// joshuafolkken/kit#4492: the no-halt rule is on demand, so only this pointer brings it into a session.
	it('points CLAUDE.md at it for a remedy for defects', () => {
		expect(read_repo_file('CLAUDE.md')).toContain('a remedy for defects → "quality-priority"')
	})

	// joshuafolkken/kit#4492: the reason for the no-halt rule lives in the rationale document only.
	it('does not point at its rationale document', () => {
		expect(read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/principles.md`)).not.toContain(
			'principles-rationale',
		)
	})
})

// joshuafolkken/kit#3865 added the prose rule; the section has to obey its own bold limit.
describe('concise-prose states the rule and follows it', () => {
	const section =
		read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/principles.md`)
			.split('\n## ')
			.find((part) => part.startsWith('concise-prose')) ?? ''

	it.each([
		'concise-prose — 文章は条件と動作だけを書く',
		'本文には、いつ何をするか（条件と動作）だけを書く',
		'理由と経緯は rationale 文書に置き',
		'太字は 1 節に 1 つまで',
		'箇条書き先頭の見出し語は数えない',
		'で引かれている太字は消さない',
		'同じ内容を言い換えて繰り返さない',
		'自分自身を説明する文',
	])('states %j', (marker) => {
		expect(section).toContain(marker)
	})

	it('uses bold at most once', () => {
		expect(section.split('**').length - 1).toBeLessThanOrEqual(2)
	})

	it('is pointed at from CLAUDE.md', () => {
		expect(read_repo_file('CLAUDE.md')).toMatch(
			/`prompts\/collaboration-workflow\/principles\.md` → "concise-prose"/u,
		)
	})
})

// joshuafolkken/kit#5328: the chat-reply rule names its order, its limit's source and its exemptions.
describe('concise-reply states the order, the limit source and the exemptions', () => {
	const section =
		read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/principles.md`)
			.split('\n## ')
			.find((part) => part.startsWith('concise-reply')) ?? ''

	it.each([
		'結論（1〜2 文）→ 表か箇条書き 1 つ → 次の一手',
		'`PROSE_LIMIT`',
		'詳しく',
		'固定出力',
		'成果物',
	])('states %j', (marker) => {
		expect(section).toContain(marker)
	})
})
