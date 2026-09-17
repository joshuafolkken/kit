import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMOVED_SKILL_MANIFEST } from './removed-skill-manifest'
import { skill_migration } from './skill-migration'

const HEX_SHA256 = /^[0-9a-f]{64}$/u

describe('REMOVED_SKILL_MANIFEST', () => {
	// The frozen hashes are the record `josh sync` compares a consumer's stale copy against, so every
	// entry must at least carry a well-formed sha256 — the only guard left once a source is gone.
	it('records a well-formed sha256 for every retired skill file', () => {
		for (const skill of REMOVED_SKILL_MANIFEST) {
			for (const file of skill.files) expect(file.sha256).toMatch(HEX_SHA256)
		}
	})

	// Where a retired skill's source is still in the repo the frozen hashes are recomputed against it
	// and must match, so drift fails here. A skill whose source has since been deleted has nothing left
	// to recompute against, so its frozen hashes stand unchecked as the permanent distributed record.
	it('matches the transformed hashes of any retired skill source still in the repo', () => {
		for (const skill of REMOVED_SKILL_MANIFEST) {
			const source_root = path.join(process.cwd(), skill.directory)
			const reference = existsSync(source_root)
				? skill_migration.expected_manifest(source_root)
				: skill.files

			expect(reference).toEqual(skill.files)
		}
	})
})
