import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2763. The records a run makes that need no CI result used to wait for the merge:
// the observation ledger was flushed as a pull request of its own after it, and the rest waited out
// the CI wait. This pins the procedure — the ledger rides the run's commit, and the records are made
// while CI runs — so the guidance cannot drift back behind `pnpm josh followup`.

const SKILL_DIR = '.claude/skills/workflow-commands'
const BACKGROUND = read_repo_file(`${SKILL_DIR}/background-commands.md`)
const FILING = read_repo_file(`${SKILL_DIR}/observation-filing.md`)
const FOLLOWUP_FOREGROUND = 'Keep `pnpm josh followup` in the foreground'
const RECORD_RULE = 'Record before the CI wait ends, never after the merge'

describe('background-commands.md — recording beside the CI wait', () => {
	it('says the commit carries the observation ledger lines recorded so far', () => {
		expect(BACKGROUND).toContain('carries the observation ledger lines recorded so far')
	})

	it('names the records made while CI runs', () => {
		expect(BACKGROUND).toContain('while CI runs the run makes the records')
	})

	it('states the recording rule in the section the gate-and-push step reads', () => {
		const section_start = BACKGROUND.indexOf('## Background the gate and push')
		const next_section = BACKGROUND.indexOf('\n## ', section_start + 1)
		const rule = BACKGROUND.indexOf(RECORD_RULE)

		expect(rule).toBeGreaterThan(section_start)
		expect(rule).toBeLessThan(next_section)
		expect(BACKGROUND.indexOf(FOLLOWUP_FOREGROUND)).toBeLessThan(rule)
	})
})

describe('observation-filing.md — the commit path', () => {
	it("states that a run's appended lines ride its own commit", () => {
		expect(FILING).toContain("A run's appended lines ride its own commit")
	})

	it('keeps the flush only for what no run commit carried', () => {
		expect(FILING).toContain("What no run's commit carried is flushed as a pull request of its own")
	})
})
