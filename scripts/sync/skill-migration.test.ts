import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { transform_copied_tree } from '#scripts/directory-copy-guard'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REMOVED_SKILL_MANIFEST } from './removed-skill-manifest'
import { skill_migration } from './skill-migration'

// The package source of truth is the kit repo itself, so a fresh copy is built the same way `josh
// sync` built it — `cpSync` then the markdown transform — and the migration must recognize it.
const PACKAGE_DIR = process.cwd()
const VERIFY_UI = '.claude/skills/verify-ui'
const EPIC_COMMANDS = '.claude/skills/epic-commands'
const DIAG = '.claude/skills/diag'
const SKILL_FILE = 'SKILL.md'
const EDITED_BY_CONSUMER = 'edited by the consumer\n'

// A holder rather than a bare `let`: `beforeEach` writes a property here rather than reassigning a
// module binding, which `unicorn/no-top-level-assignment-in-function` forbids.
const context = { project: '' }

beforeEach(() => {
	context.project = mkdtempSync(path.join(os.tmpdir(), 'skill-migration-'))
})

afterEach(() => {
	rmSync(context.project, { recursive: true, force: true })
})

function copy_clean(relative: string): void {
	const source = path.join(PACKAGE_DIR, relative)
	const destination = path.join(context.project, relative)

	mkdirSync(destination, { recursive: true })
	cpSync(source, destination, { recursive: true })
	transform_copied_tree(source, destination)
}

function action_for(relative: string): string | undefined {
	return skill_migration
		.migrate_removed_skill_directories(PACKAGE_DIR, context.project)
		.find((result) => result.directory === relative)?.action
}

function retired_action_for(relative: string): string | undefined {
	return skill_migration
		.migrate_manifest_skills(context.project, REMOVED_SKILL_MANIFEST)
		.find((result) => result.directory === relative)?.action
}

describe('skill_migration.migrate_removed_skill_directories', () => {
	it('removes an unmodified copy', () => {
		copy_clean(VERIFY_UI)

		expect(action_for(VERIFY_UI)).toBe('removed')
		expect(existsSync(path.join(context.project, VERIFY_UI))).toBe(false)
	})

	it('keeps a copy the consumer edited', () => {
		copy_clean(EPIC_COMMANDS)
		writeFileSync(path.join(context.project, EPIC_COMMANDS, SKILL_FILE), EDITED_BY_CONSUMER)

		expect(action_for(EPIC_COMMANDS)).toBe('kept')
		expect(existsSync(path.join(context.project, EPIC_COMMANDS))).toBe(true)
	})

	it('reports absent when the consumer never received the copy', () => {
		expect(action_for(VERIFY_UI)).toBe('absent')
	})
})

describe('skill_migration.migrate_manifest_skills', () => {
	it('removes an unmodified retired-skill copy', () => {
		copy_clean(DIAG)

		expect(retired_action_for(DIAG)).toBe('removed')
		expect(existsSync(path.join(context.project, DIAG))).toBe(false)
	})

	it('keeps a retired-skill copy the consumer edited', () => {
		copy_clean(DIAG)
		writeFileSync(path.join(context.project, DIAG, SKILL_FILE), EDITED_BY_CONSUMER)

		expect(retired_action_for(DIAG)).toBe('kept')
		expect(existsSync(path.join(context.project, DIAG))).toBe(true)
	})

	it('reports absent when the consumer never received the retired skill', () => {
		expect(retired_action_for(DIAG)).toBe('absent')
	})
})

// The note text is what tells a consumer why the copy went, and it branches on `source`. Pinned
// directly so flipping the ternary — telling a consumer a retired skill is "now provided by the kit
// plugin" — fails a test rather than shipping a misleading line.
describe('skill_migration note text', () => {
	it('distinguishes a retired skill from a plugin skill', () => {
		expect(skill_migration.removed_note('retired')).toBe('retired from distribution')
		expect(skill_migration.removed_note('plugin')).toBe('now provided by the kit plugin')
		expect(skill_migration.kept_note('retired')).toBe(
			'modified or consumer-authored — remove by hand',
		)
		expect(skill_migration.kept_note('plugin')).toBe(
			'modified or consumer-authored — remove by hand once on the kit plugin',
		)
	})
})
