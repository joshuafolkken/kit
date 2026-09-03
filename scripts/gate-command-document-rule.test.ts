import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file } from './ai-document-fixture'

// joshuafolkken/kit#914: the command only saves a round trip if the documents that define the gate
// actually route to it. A command shipped while every entry point still lists the four serial steps
// is a command nobody runs.
//
// It sits beside `verification-gate.test.ts` rather than inside it because it is about the
// documents, not the gate: it needs none of that file's execa mock, stdout capture or step
// scaffolding, and keeping it there was what pushed the file past its line limit
// (joshuafolkken/kit#1258).
describe('the gate command is what the documents tell an AI to run', () => {
	const GATE_COMMAND = 'pnpm josh gate'

	it.each(AI_DOCS)('names the command in the completion gate of %s', (document_name) => {
		expect(read_repo_file(document_name)).toContain(GATE_COMMAND)
	})

	it.each([
		'.claude/skills/workflow-commands/SKILL.md',
		'.claude/skills/workflow-commands/fullrun.md',
		'.claude/skills/workflow-commands/halfrun.md',
		'.claude/skills/workflow-commands/queue.md',
	])('names the command in the gate description of %s', (skill_path) => {
		expect(read_repo_file(skill_path)).toContain(GATE_COMMAND)
	})
})
