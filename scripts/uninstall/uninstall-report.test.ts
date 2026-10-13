import { describe, expect, it } from 'vitest'
import { uninstall_report, type UninstallPlan } from './uninstall-report'

const EMPTY_PLAN: UninstallPlan = {
	files: { remove: [], keep: [] },
	has_manifest_entries: false,
	has_git_hooks: false,
	review: [],
}
const FULL_PLAN: UninstallPlan = {
	files: { remove: ['AGENTS.md'], keep: ['CLAUDE.md'] },
	has_manifest_entries: true,
	has_git_hooks: true,
	review: ['package.json scripts.josh'],
}
const SECTION_SEPARATOR = '\n\n'

function sections(plan: UninstallPlan): Array<string> {
	return uninstall_report.describe(plan).split(SECTION_SEPARATOR)
}

describe('describe', () => {
	it('lists what is removed, including the manifest entries and the git hooks', () => {
		const [removal] = sections(FULL_PLAN)

		expect(removal).toMatch(/^Remove /u)
		expect(removal).toContain('  AGENTS.md')
		expect(removal).toContain('@joshuafolkken/kit dependency')
		expect(removal).toContain('lefthook uninstall')
	})

	it('lists the kept files and the entries to review in their own sections', () => {
		const [, kept, review] = sections(FULL_PLAN)

		expect(kept).toMatch(/^Keep [^\n]*\n {2}CLAUDE\.md$/u)
		expect(review).toMatch(/^Review by hand [^\n]*\n {2}package\.json scripts\.josh$/u)
	})

	it('marks a section with nothing in it', () => {
		expect(sections(EMPTY_PLAN).every((section) => section.endsWith('(nothing)'))).toBe(true)
	})
})

describe('is_empty', () => {
	it('is true when there is nothing to remove', () => {
		expect(uninstall_report.is_empty({ ...EMPTY_PLAN, review: ['x'] })).toBe(true)
	})

	it.each([
		{ ...EMPTY_PLAN, files: { remove: ['a'], keep: [] } },
		{ ...EMPTY_PLAN, has_manifest_entries: true },
		{ ...EMPTY_PLAN, has_git_hooks: true },
	])('is false when a file, the manifest or the hooks are to be removed', (plan) => {
		expect(uninstall_report.is_empty(plan)).toBe(false)
	})
})

describe('next_steps', () => {
	it('names the install that drops the package and what stays on GitHub', () => {
		const steps = uninstall_report.next_steps()

		expect(steps).toContain('pnpm install')
		expect(steps).toContain('GitHub')
	})

	it('puts the hand review ahead of the install that would reinstall the git hooks', () => {
		expect(uninstall_report.next_steps()).toMatch(/Review by hand[^\n]*\n[^\n]*pnpm install/u)
	})
})
