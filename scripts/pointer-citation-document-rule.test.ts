import { statSync } from 'node:fs'
import {
	PROMPT_ROOT,
	read_index,
	read_repo_file,
	read_unwrapped,
	routing_documents,
	WORKFLOW_PROMPT,
	WORKFLOW_PROMPT_DIRECTORY,
	workflow_prompt_files,
} from '#scripts/ai-document-fixture'
import { package_file } from '#scripts/skill-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1178: joshuafolkken/kit#1174 and joshuafolkken/kit#1177 single-sourced two rule
// bodies into their skills and left the canonical topic files as pointers — and then cited those
// pointers differently. One kept `CLAUDE.md` naming the topic file as the "Canonical reference",
// the other pointed every citation at the skill instead. Twelve more topics are queued behind them
// (joshuafolkken/kit#1176), so the convention has to be one thing before they are written.
//
// The decision: a citation names the file the body is in. A topic file that has become a pointer is
// reached from the index, never from a citation elsewhere — naming it restores the two-hop read the
// index's own "参照の書き方" prohibits, through a file that holds no body at all.

// The declaration a canonical topic file opens with once its body lives in a skill. Detection is by
// this sentence rather than by a hard-coded list, so the rollout's remaining topics are covered the
// moment they are converted instead of when someone remembers to add them here.
//
// It has to be the declaration and not merely the phrase: `residency.md` quotes the phrase while
// describing this very rule, and a substring match would read that as a pointer to whichever skill
// its prose happened to name first. Anchoring to a bold line that opens with it, and taking the
// skill path out of that same line, is what keeps a document *about* the convention from being
// mistaken for one *under* it.
const POINTER_MARKER = 'この規則の単一ソースは'
// A raw template cannot carry an escaped backtick, so the delimiter is interpolated like the marker.
const BACKTICK = '`'
const POINTER_DECLARATION = new RegExp(
	String.raw`^\*\*${POINTER_MARKER}[^${BACKTICK}]*${BACKTICK}(\.claude/skills/[\w./-]+\.md)${BACKTICK}`,
	'mu',
)
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
// `collaboration-workflow` — the one segment `prompts/collaboration-workflow/x.md` and a relative
// `./collaboration-workflow/x.md` link both carry.
const TOPIC_DIRECTORY_NAME = WORKFLOW_PROMPT_DIRECTORY.slice(PROMPT_ROOT.length + 1)

// The topic file that states the convention rather than living under it. It quotes the marker while
// explaining the declaration, so the candidate check below would otherwise read it as a conversion
// whose declaration is malformed.
const CONVENTION_TOPICS: ReadonlySet<string> = new Set([RESIDENCY])

interface PointerTopic {
	topic: string
	skill: string
}

function pointer_topics(): ReadonlyArray<PointerTopic> {
	return workflow_prompt_files().flatMap((path) => {
		const skill = POINTER_DECLARATION.exec(read_repo_file(path))?.[1]

		return skill === undefined ? [] : [{ skill, topic: path }]
	})
}

// Anything that reads as a conversion, however it was worded. Detection by a strict declaration is
// only safe while a near-miss is louder than a silent drop-out: a topic converted under
// joshuafolkken/kit#1176 with the sentence phrased differently would otherwise fall out of every
// assertion here and take its citations with it, and the suite would stay green.
function candidate_topics(): ReadonlyArray<string> {
	return workflow_prompt_files().filter(
		(path) => read_repo_file(path).includes(POINTER_MARKER) && !CONVENTION_TOPICS.has(path),
	)
}

// Every document a reader could be routed from. The pointer's own file is excluded because it is
// what carries the pointer, and its skill because naming its own pointer is the reverse direction —
// a back-reference costs no second hop. The index is excluded because `read_repo_file` deliberately
// answers it with the whole concatenated corpus, which contains every citation there is.
function citing_documents(pointer: PointerTopic): ReadonlyArray<string> {
	const exempt = new Set([pointer.topic, pointer.skill, WORKFLOW_PROMPT])

	return routing_documents().filter((path) => !exempt.has(path))
}

function byte_size(relative_path: string): number {
	return statSync(package_file(relative_path)).size
}

// A citation is matched by the path it ends in, not by one spelling of it. `prompts/…/x.md`, a
// relative link `](./collaboration-workflow/x.md)`, a bare `` `x.md` `` from a sibling and a
// sibling link `](./x.md)` are the same routing decision written four ways, and a rule that pinned
// one of them would go green on the other three. What a document may still carry is the *skill*
// path, which ends in the same file name — so it is removed before the search rather than matched
// around.
function cites_pointer(document_path: string, pointer: PointerTopic): boolean {
	const name = pointer.topic.slice(`${WORKFLOW_PROMPT_DIRECTORY}/`.length)
	const content = read_repo_file(document_path).replaceAll(pointer.skill, '')

	// Inside the topic directory a bare file name is already a citation; from anywhere else it takes
	// the directory in front of it, and that segment is what the absolute and relative forms share.
	return document_path.startsWith(`${WORKFLOW_PROMPT_DIRECTORY}/`)
		? content.includes(name)
		: content.includes(`${TOPIC_DIRECTORY_NAME}/${name}`)
}

describe('a canonical topic file that has become a pointer', () => {
	// The detection is the suite. Matching nothing would make every assertion below vacuous, and the
	// convention would read as enforced while nothing was checked.
	it('is found by the marker the convention is written around', () => {
		expect(pointer_topics().length).toBeGreaterThan(0)
	})

	// A near-miss has to be louder than a drop-out. Every file that reads as a conversion must match
	// the declaration the convention names, or the rule below silently stops applying to it.
	it('declares itself in the one form the detection reads', () => {
		expect(candidate_topics()).toEqual(pointer_topics().map((pointer) => pointer.topic))
	})

	it.each(pointer_topics())('$topic names a skill file that exists', (pointer) => {
		expect(() => byte_size(pointer.skill)).not.toThrow()
	})

	// The two conversions the convention was decided over. Named rather than counted, so the suite
	// keeps covering them as joshuafolkken/kit#1176 adds the remaining topics — `arrayContaining`
	// because a rollout that grows this list must not have to edit the test that guards it.
	it('sees the two topics converted so far', () => {
		expect(pointer_topics().map((pointer) => pointer.topic)).toEqual(
			expect.arrayContaining([
				'prompts/collaboration-workflow/eval-gate.md',
				'prompts/collaboration-workflow/split-assessment.md',
			]),
		)
	})

	// A pointer that grew a body back would satisfy every citation rule below while re-creating the
	// clone the rollout removed. The skill is the long file; the pointer is a paragraph.
	it.each(pointer_topics())('$topic stays smaller than the body it points at', (pointer) => {
		expect(byte_size(pointer.topic)).toBeLessThan(byte_size(pointer.skill))
	})
})

// The rule itself. `into-epic.md` cited a sibling by bare name and reported green against a check
// that knew only the full path, which is why `cites_pointer` matches the routing decision rather
// than one spelling of it.
describe('a pointer is reached from the index, never from a citation', () => {
	// Reported as the list of offenders rather than one case per document, so a failure names every
	// place that has to change instead of the first one alphabetically.
	it.each(pointer_topics())('$topic is cited by nothing but its own skill', (pointer) => {
		const offenders = citing_documents(pointer).filter((path) => cites_pointer(path, pointer))

		expect(offenders).toEqual([])
	})
})

// Recording the decision is half of it: the next topic converted under joshuafolkken/kit#1176 is
// written by whoever reads these two files, and a convention that lived only in a test comment is
// what joshuafolkken/kit#1178 was filed about.
describe('the decision is written where the next conversion will read it', () => {
	it('is recorded in the residency topic with its criterion', () => {
		const content = read_unwrapped(RESIDENCY)

		expect(content).toContain('指し先になった話題ファイルは引用しない')
		expect(content).toContain('その話題の本文はどのファイルにあるか')
		expect(content).toContain(POINTER_MARKER)
	})

	// The index read raw, never through the corpus-concatenating reader: a marker asserted through
	// that one would pass on prose sitting in any topic file rather than in the index itself.
	it('is what the index tells a citation to do', () => {
		const content = read_index().replaceAll(/\s+/gu, ' ')

		expect(content).toContain('**本文があるファイルを直接指す**')
		expect(content).toContain('residency.md')
	})
})
