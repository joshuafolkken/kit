import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it, vi } from 'vitest'
import { layer_fixture } from './layer-fixture'
import { layers_cli } from './layers-cli'

const COMMAND_NAME = 'layers'
const WORKFLOWS = '.github/workflows'

// A checkout carrying only the fixture's configuration, so the command's own reading is exercised
// end to end rather than only its argument parsing.
function write_project(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'layers-cli-'))
	const workflows = path.join(root, WORKFLOWS)

	mkdirSync(workflows, { recursive: true })
	writeFileSync(path.join(root, 'lefthook.yml'), layer_fixture.HOOKS_YAML)
	writeFileSync(path.join(workflows, 'ci.yml'), layer_fixture.PULL_REQUEST_WORKFLOW)
	writeFileSync(path.join(workflows, 'publish.yml'), layer_fixture.PUSH_ONLY_WORKFLOW)

	return root
}

describe('josh layers — registration', () => {
	it('registers the command against its CLI script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe('scripts/layers/layers-cli.ts')
	})

	it('registers the command in a category', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.category).toBe('AI tools')
	})

	it('registers the short alias', () => {
		const { ly } = ALIASES

		expect(ly).toBe(COMMAND_NAME)
	})
})

describe('josh layers — reading a project', () => {
	it('produces the same duplication list the configuration files describe', () => {
		const report = layers_cli.build(write_project())

		expect(report.repeated.map((row) => row.check)).toStrictEqual([
			'cspell',
			'eslint',
			'type-check',
			'unit-tests',
			'dependency-install',
			'prettier',
		])
	})

	it('reports the gate as a layer even where the project has no configuration files at all', () => {
		const bare = mkdtempSync(path.join(tmpdir(), 'layers-bare-'))
		const report = layers_cli.build(bare)

		expect(report.layers).toStrictEqual(['gate'])
	})
})

describe('josh layers — the command line', () => {
	it('refuses an unknown flag rather than reporting on a project named by it', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(layers_cli.run(['--nope'])).toBe(1)
		expect(errors).toHaveBeenCalledWith(layers_cli.USAGE)
		errors.mockRestore()
	})

	it('prints the report as text by default', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(layers_cli.run(['--root', write_project()])).toBe(0)
		expect(info.mock.calls[0]?.[0]).toContain('Verification layers')
		info.mockRestore()
	})

	it('prints the whole report as JSON under --json', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		layers_cli.run(['--root', write_project(), '--json'])
		const printed: unknown = JSON.parse(String(info.mock.calls[0]?.[0]))

		info.mockRestore()

		expect(Object.keys(printed ?? {})).toStrictEqual(['layers', 'repeated', 'single', 'unresolved'])
	})
})
