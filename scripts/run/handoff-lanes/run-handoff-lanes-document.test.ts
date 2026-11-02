import { read_document } from '#scripts/document/ai-document-fixture'
import { document_section } from '#scripts/document/document-section'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#5901: `run:handoff-lanes` chains the hand-off, so the section names that one
// command and its four verdicts; the steps it chains are the command's own, never typed by hand.

const PROGRESS_MD = '.claude/skills/workflow-commands/backlogrun-progress.md'
const HEADING = 'The hand-off'
const COMMAND = 'pnpm josh run:handoff-lanes'
const VERDICTS = ['| `under`', '| `cut`', '| `blocked', '| `capped`']
const CHAINED_STEPS = ['pnpm josh run:carry --cut', 'pnpm josh lane:list', 'pnpm josh run:board']

function hand_off_text(): string {
	return document_section.section(read_document(PROGRESS_MD), HEADING)?.text ?? ''
}

describe('backlogrun-progress.md → "The hand-off"', () => {
	it('names the chaining command', () => {
		expect(hand_off_text()).toContain(COMMAND)
	})

	it.each(VERDICTS)('names the %s verdict', (verdict) => {
		expect(hand_off_text()).toContain(verdict)
	})

	it.each(CHAINED_STEPS)('does not list the chained step %s by hand', (chained) => {
		expect(hand_off_text()).not.toContain(chained)
	})
})
