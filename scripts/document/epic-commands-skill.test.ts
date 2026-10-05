import { readFileSync } from 'node:fs'
import { skill_meta } from '#scripts/claude/skill-meta'
import { describe, expect, it } from 'vitest'

const SKILL_DIRECTORY = '.claude/skills/epic-commands'
const SKILL = readFileSync(`${SKILL_DIRECTORY}/SKILL.md`, 'utf8')
const RESIDENT = readFileSync('CLAUDE.md', 'utf8')
const SCOUT = readFileSync('.claude/skills/workflow-commands/issue-scout.md', 'utf8')
const BUNDLE_TRIGGER = 'when `epic:bundle` places a filed issue'
const EVERY_FILING_TRIGGER = 'right after filing an issue'
const REFERENCES = ['execution-waves.md', 'epic-bundle.md']
const DESCRIPTION = skill_meta.description_of(SKILL)

describe('the epic-commands read trigger', () => {
	it('is no longer fired by every filing', () => {
		expect(RESIDENT).not.toContain(EVERY_FILING_TRIGGER)
		expect(DESCRIPTION).not.toContain(EVERY_FILING_TRIGGER)
	})

	it('fires on a placing epic:bundle answer in CLAUDE.md and the skill description alike', () => {
		expect(RESIDENT).toContain(BUNDLE_TRIGGER)
		expect(DESCRIPTION).toContain(BUNDLE_TRIGGER)
	})

	it('is named where the filing prints the answer', () => {
		expect(SCOUT).toContain('a placing answer\n  reads the `epic-commands` skill')
	})
})

describe('the epic-commands skill body', () => {
	it('drops the retired epic:plan history', () => {
		expect(SKILL).not.toContain('epic:plan')
	})

	it.each(REFERENCES)('routes to %s rather than carrying it', (reference) => {
		expect(SKILL).toContain(`\`${reference}\``)
		expect(readFileSync(`${SKILL_DIRECTORY}/${reference}`, 'utf8')).toMatch(/^# /u)
	})

	it('keeps the placement table that every placing answer acts on', () => {
		expect(SKILL).toContain('| Spread across **different** epics |')
	})
})
