import { describe, expect, it } from 'vitest'
import { init_ai_copy } from './init-ai-copy'
import type { ProjectShape } from './project-profile'

const STATIC_SHAPE: ProjectShape = {
	profile: 'static',
	reason: 'test',
	has_web: false,
	has_typescript: false,
	has_git: false,
	has_github: false,
}
const GIT_ATTRIBUTES = '.gitattributes'
const SECURITY_MD = 'SECURITY.md'

describe('profile-specific AI files', () => {
	it('keeps Git-free, Web-free static files to pointers', () => {
		expect(init_ai_copy.ai_files(STATIC_SHAPE)).toEqual([
			'AGENTS.md',
			'GEMINI.md',
			'pnpm-workspace.yaml',
		])
	})

	it('adds Web and Git files only when those axes are present', () => {
		const files = init_ai_copy.ai_files({
			...STATIC_SHAPE,
			has_web: true,
			has_git: true,
			has_github: true,
		})

		expect(files).toContain('.prettierignore')
		expect(files).toContain(GIT_ATTRIBUTES)
		expect(files).toContain(SECURITY_MD)
	})

	it('keeps node development settings without GitHub distribution', () => {
		const files = init_ai_copy.ai_files({ ...STATIC_SHAPE, profile: 'node' })

		expect(files).not.toContain('.claude/settings.json')
		expect(files).not.toContain(GIT_ATTRIBUTES)
		expect(files).not.toContain(SECURITY_MD)
	})
})
