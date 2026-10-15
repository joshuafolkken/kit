import { describe, expect, it } from 'vitest'
import { init_ai_copy } from './init-ai-copy'
import type { ProjectShape } from './project-profile'

const BASIC_SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	has_web: false,
	has_typescript: false,
	has_git: false,
	has_github: false,
	has_workflow: false,
}
const GIT_ATTRIBUTES = '.gitattributes'
const SECURITY_MD = 'SECURITY.md'
const CLAUDE_SETTINGS = '.claude/settings.json'

describe('profile-specific AI files', () => {
	it('keeps Git-free, Web-free basic files to pointers', () => {
		expect(init_ai_copy.ai_files(BASIC_SHAPE)).toEqual([
			'AGENTS.md',
			'GEMINI.md',
			'pnpm-workspace.yaml',
		])
	})

	it('adds Web and Git files only when those axes are present', () => {
		const files = init_ai_copy.ai_files({
			...BASIC_SHAPE,
			has_web: true,
			has_git: true,
			has_github: true,
		})

		expect(files).toContain('.prettierignore')
		expect(files).toContain(GIT_ATTRIBUTES)
		expect(files).toContain(SECURITY_MD)
	})

	it('keeps node development settings without GitHub distribution', () => {
		const files = init_ai_copy.ai_files({ ...BASIC_SHAPE, profile: 'full' })

		expect(files).not.toContain(CLAUDE_SETTINGS)
		expect(files).not.toContain(GIT_ATTRIBUTES)
		expect(files).not.toContain(SECURITY_MD)
	})

	it('writes SECURITY.md from the consumer template on every profile', () => {
		const template = 'templates/SECURITY.md'

		expect(init_ai_copy.ai_file_source(SECURITY_MD)).toBe(template)
		expect(init_ai_copy.ai_file_source(SECURITY_MD, BASIC_SHAPE)).toBe(template)
		expect(init_ai_copy.ai_file_source('AGENTS.md')).toBe('AGENTS.md')
	})
})

describe('profile-specific agent pointers', () => {
	it.each(['AGENTS', 'GEMINI'])(
		'writes %s.md from the basic template on basic and from kit on full',
		(name) => {
			const filename = `${name}.md`

			expect(init_ai_copy.ai_file_source(filename, BASIC_SHAPE)).toBe(`templates/${name}.basic.md`)
			expect(init_ai_copy.ai_file_source(filename, { ...BASIC_SHAPE, profile: 'full' })).toBe(
				filename,
			)
		},
	)
})

describe('AI files of a basic project josh start set up (#3796)', () => {
	it('adds .claude/settings.json in a Git repository', () => {
		const workflow = { ...BASIC_SHAPE, has_workflow: true }

		expect(init_ai_copy.ai_files({ ...workflow, has_git: true })).toContain(CLAUDE_SETTINGS)
		expect(init_ai_copy.ai_files({ ...BASIC_SHAPE, has_git: true })).not.toContain(CLAUDE_SETTINGS)
		expect(init_ai_copy.ai_files(workflow)).not.toContain(CLAUDE_SETTINGS)
	})
})
