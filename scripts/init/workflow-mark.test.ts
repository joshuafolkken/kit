import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { project_profile } from './project-profile'
import { workflow_mark } from './workflow-mark'

const WORKFLOW_ENV = 'JOSH_WORKFLOW'
const roots: Array<string> = []

function fixture(manifest?: Record<string, unknown>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-workflow-mark-'))

	roots.push(root)

	if (manifest !== undefined) {
		writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
	}

	return root
}

beforeEach(() => {
	vi.stubEnv(WORKFLOW_ENV, undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('the GitHub workflow mark (#3796)', () => {
	it('is requested only by the value josh start sets', () => {
		expect(workflow_mark.is_requested({ [WORKFLOW_ENV]: 'github' })).toBe(true)
		expect(workflow_mark.is_requested({ [WORKFLOW_ENV]: 'gitlab' })).toBe(false)
		expect(workflow_mark.is_requested({})).toBe(false)
	})

	it('sets the variable a setup it hands off to inherits', () => {
		const environment = {}

		workflow_mark.request(environment)

		expect(workflow_mark.is_requested(environment)).toBe(true)
	})

	it('reads the mark recorded in the josh record of package.json', () => {
		expect(workflow_mark.is_recorded({ josh: { profile: 'basic', workflow: 'github' } })).toBe(true)
		expect(workflow_mark.is_recorded({ josh: { profile: 'basic' } })).toBe(false)
		expect(workflow_mark.is_recorded({ josh: 'github' })).toBe(false)
		expect(workflow_mark.is_recorded(undefined)).toBe(false)
	})

	it('records a field only for a project josh start set up', () => {
		expect(workflow_mark.recorded_fields(true)).toEqual({ workflow: 'github' })
		expect(workflow_mark.recorded_fields(false)).toEqual({})
	})
})

describe('the project shape reads the mark', () => {
	it('from package.json, where josh sync finds it', () => {
		const root = fixture({ josh: { profile: 'basic', workflow: 'github' } })

		expect(project_profile.inspect_project(root, 'basic').has_workflow).toBe(true)
	})

	it('from the josh start run before package.json exists', () => {
		vi.stubEnv(WORKFLOW_ENV, 'github')

		expect(project_profile.inspect_project(fixture()).has_workflow).toBe(true)
	})

	it('as absent for a project josh init alone set up', () => {
		const root = fixture({ josh: { profile: 'basic' } })

		expect(project_profile.inspect_project(root).has_workflow).toBe(false)
		expect(project_profile.inspect_project(fixture()).has_workflow).toBe(false)
	})
})
