import { readFileSync } from 'node:fs'
import { skill_meta } from '#scripts/claude/skill-meta'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3394: every session loads each skill's description, so the four run-facing ones
// are held under one byte budget. Trimming must keep what an agent matches the situation against,
// so each skill's trigger keywords are asserted beside the budget.
const DESCRIPTION_BUDGET_BYTES = 1024

const TRIGGERS: Record<string, Array<string>> = {
	'workflow-commands': ['`kickoff`', '`fullrun`', '`halfrun`', '`prrun`', '`backlogrun`', '`new`'],
	'epic-commands': ['`josh epic:audit`', '`epic:next`', '`epic:bundle`', '`needs-decision`'],
	'dependency-update': ['`pnpm update`', '`josh latest`', '`pnpm josh overrides`', '`devEngines`'],
	'verify-ui': ['UI', 'layout', 'styling', 'interaction'],
}

function description(skill: string): string {
	const content = readFileSync(
		`${skill_meta.SKILL_ROOT}/${skill}/${skill_meta.SKILL_ENTRY_FILE}`,
		'utf8',
	)

	return skill_meta.description_of(content)
}

function total_bytes(): number {
	return Object.keys(TRIGGERS).reduce(
		(sum, skill) => sum + Buffer.byteLength(description(skill), 'utf8'),
		0,
	)
}

describe('run-facing skill descriptions', () => {
	it('stay under the shared byte budget', () => {
		expect(total_bytes()).toBeLessThan(DESCRIPTION_BUDGET_BYTES)
	})

	it.each(Object.entries(TRIGGERS))('%s keeps its trigger keywords', (skill, keywords) => {
		for (const keyword of keywords) expect(description(skill)).toContain(keyword)
	})
})
