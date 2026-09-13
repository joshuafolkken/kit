import { all_documents, read_document } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'
import { RETIRED_PHRASES } from './retired-phrases'

// The two tables that replaced the ~140 per-phrase marker suites (joshuafolkken/kit#1923).
//
// **Anchors** pin one heading per resident rule. A rule that must stay in `CLAUDE.md` or a workflow
// skill is not always cited by a `` → "Heading" `` reference elsewhere, so link resolution would not
// notice it being deleted — this table is what does. One rule, one anchor, matched by prefix exactly
// as `pnpm josh doc:section` matches, so the gloss after a heading's title does not have to be
// repeated here.
//
// **Retired phrases** stay absent everywhere, so a clone or a reverted decision cannot creep back.
// That is the small negative table the acceptance criteria call for, sourced from `retired-phrases.ts`.

interface Anchor {
	file: string
	heading: string
}

const CLAUDE_MD = 'CLAUDE.md'
const SKILL_MD = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN_MD = '.claude/skills/workflow-commands/fullrun.md'
const EPICRUN_MD = '.claude/skills/workflow-commands/epicrun.md'
const SPLIT_MD = '.claude/skills/workflow-commands/split-assessment.md'

const RESIDENT_ANCHORS: ReadonlyArray<Anchor> = [
	{ file: CLAUDE_MD, heading: 'Communication' },
	{ file: CLAUDE_MD, heading: 'Decision autonomy' },
	{ file: CLAUDE_MD, heading: 'Critical Conventions' },
	{ file: CLAUDE_MD, heading: 'Naming' },
	{ file: CLAUDE_MD, heading: 'Functions & exports' },
	{ file: CLAUDE_MD, heading: 'Files' },
	{ file: CLAUDE_MD, heading: 'Quality limits' },
	{ file: CLAUDE_MD, heading: 'Content rules' },
	{ file: CLAUDE_MD, heading: 'Dependency overrides' },
	{ file: CLAUDE_MD, heading: 'Package-First Development' },
	{ file: CLAUDE_MD, heading: 'Code Change Rules' },
	{ file: CLAUDE_MD, heading: 'Completion gate' },
	{ file: CLAUDE_MD, heading: 'Refactoring Rules' },
	{ file: CLAUDE_MD, heading: 'Pre-commit Self-Review' },
	{ file: CLAUDE_MD, heading: 'Doc Sync Rules' },
	{ file: CLAUDE_MD, heading: 'Git Rules' },
	{ file: CLAUDE_MD, heading: 'Collaboration Workflow' },
	{ file: CLAUDE_MD, heading: 'Shorthand Commands' },
	{ file: CLAUDE_MD, heading: 'Explicit invocation required' },
	{ file: CLAUDE_MD, heading: 'Mid-workflow stop notification' },
	{ file: SKILL_MD, heading: '0. The rule that fires before any of them' },
	{ file: SKILL_MD, heading: '1. Which file to read' },
	{ file: SKILL_MD, heading: '2. What every one of them shares' },
	{ file: SKILL_MD, heading: '2b. Delegating a step to a cheaper tier' },
	{ file: SKILL_MD, heading: '3. What stays resident, and what is read from here' },
	{ file: FULLRUN_MD, heading: '`fullrun`' },
	{ file: EPICRUN_MD, heading: 'The hand-off' },
	{ file: EPICRUN_MD, heading: 'park and continue' },
	{ file: EPICRUN_MD, heading: 'When `#N` is not an epic' },
	{ file: EPICRUN_MD, heading: 'Lanes' },
	{ file: SPLIT_MD, heading: 'The question' },
	{ file: SPLIT_MD, heading: 'Two or more always means an epic' },
	{ file: 'prompts/review.md', heading: 'Review round cap' },
	{ file: 'prompts/testing-guide.md', heading: '6. Closing the E2E gate without a human run' },
]

function unwrapped_corpus(): string {
	return all_documents()
		.map((path) => read_document(path))
		.join('\n')
		.replaceAll(/\s+/gu, ' ')
}

const CORPUS = unwrapped_corpus()

describe('resident rules keep their anchor heading', () => {
	it.each(RESIDENT_ANCHORS)('$file carries "$heading"', ({ file, heading }) => {
		expect(document_section.section(read_document(file), heading)).toBeDefined()
	})
})

describe('retired phrases stay gone', () => {
	it.each(RETIRED_PHRASES)('no document brings back %s', (phrase) => {
		expect(CORPUS).not.toContain(phrase.replaceAll(/\s+/gu, ' '))
	})
})
