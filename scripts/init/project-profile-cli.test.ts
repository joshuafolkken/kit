import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { project_profile_cli } from './project-profile-cli'

// The phrase a `ci.yml` synced before joshuafolkken/kit#2829 matches with `*'profile: static ('*` to
// hand a basic project to `josh gate`, and the one the current template matches.
const LEGACY_MATCH = 'profile: static ('
const CURRENT_MATCH = 'profile: basic ('
const BASIC_RESULT = { profile: 'basic', reason: 'no package.json' }
// The profile step's `case` from the ci.yml template as it was before the rename.
const LEGACY_CASE = `case "\${PROFILE_OUTPUT}" in
  *'profile: static ('*) echo 'is_static=true' ;;
  *) echo 'is_static=false' ;;
esac`

describe('josh profile output', () => {
	it('names a basic project for both the current and the pre-rename workflow', () => {
		const output = project_profile_cli.describe(BASIC_RESULT)

		expect(output).toContain(CURRENT_MATCH)
		expect(output).toContain(LEGACY_MATCH)
	})

	it('is matched by the pre-rename ci.yml case statement', () => {
		const output = project_profile_cli.describe(BASIC_RESULT)
		const result = spawnSync('bash', ['-c', LEGACY_CASE], {
			encoding: 'utf8',
			env: { ...process.env, PROFILE_OUTPUT: output },
		})

		expect(result.stdout.trim()).toBe('is_static=true')
	})

	it('names a full project for neither basic matcher', () => {
		const output = project_profile_cli.describe({ profile: 'full', reason: 'package dependencies' })

		expect(output).toBe('profile: full (package dependencies)')
		expect(output).not.toContain(LEGACY_MATCH)
	})
})
