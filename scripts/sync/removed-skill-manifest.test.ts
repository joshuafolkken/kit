import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMOVED_SKILL_MANIFEST } from './removed-skill-manifest'
import { skill_migration } from './skill-migration'

// The manifest hashes are frozen, so they must be recomputed against the repo's own skill source or
// they silently stop matching what `josh sync` distributed. This fails on any drift, which is the
// signal to regenerate the manifest deliberately.
describe('REMOVED_SKILL_MANIFEST', () => {
	it('matches the transformed hashes of the retired skill sources in the repo', () => {
		for (const skill of REMOVED_SKILL_MANIFEST) {
			const source_root = path.join(process.cwd(), skill.directory)

			expect(skill_migration.expected_manifest(source_root)).toEqual(skill.files)
		}
	})
})
