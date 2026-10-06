import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { yaml_document } from '#scripts/lib/yaml-document'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init_ai_copy } from './init-ai-copy'

// `josh init` and `josh sync` read the workspace template through this, so a project's own `.npmrc`
// window and engine check reach `pnpm-workspace.yaml` instead of kit's defaults (kit#3267).
const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const TEMPLATE = 'allowBuilds:\n  esbuild: true\n\nminimumReleaseAge: 1440\nengineStrict: true\n'

describe('init_ai_copy.read_workspace_template', () => {
	let project = ''
	let template_path = ''

	beforeEach(() => {
		project = mkdtempSync(path.join(tmpdir(), 'workspace-npmrc-'))
		template_path = path.join(project, 'template.yaml')
		writeFileSync(template_path, TEMPLATE)
	})

	afterEach(() => {
		rmSync(project, { recursive: true, force: true })
	})

	it('carries the .npmrc beside the destination into the template', () => {
		writeFileSync(path.join(project, '.npmrc'), 'minimum-release-age=4320\nengine-strict=false\n')
		const destination = path.join(project, WORKSPACE_YAML)

		expect(
			yaml_document.parse_yaml(init_ai_copy.read_workspace_template(template_path, destination)),
		).toMatchObject({ minimumReleaseAge: 4320, engineStrict: false })
	})

	it('returns the template unchanged when the project has no .npmrc', () => {
		const destination = path.join(project, WORKSPACE_YAML)

		expect(init_ai_copy.read_workspace_template(template_path, destination)).toBe(TEMPLATE)
	})
})
