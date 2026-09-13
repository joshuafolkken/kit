import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor } from './doctor'
import { doctor_consumer } from './doctor-consumer'

const KIT = '@joshuafolkken/kit'
const PLUGIN_ID = 'kit@kit'
const PACKAGE_JSON = 'package.json'
const SETTINGS_JSON = '.claude/settings.json'
const TARGET_MISSING = 'target-missing'

function temporary_project(): string {
	return mkdtempSync(path.join(tmpdir(), 'doctor-consumer-'))
}

function write_file(root: string, relative: string, content: string): void {
	const file_path = path.join(root, relative)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, content)
}

describe('doctor.parse_options', () => {
	it('leaves the port table off by default', () => {
		expect(doctor.parse_options([]).show_ports).toBe(false)
	})

	it('turns the port table on with --ports', () => {
		expect(doctor.parse_options(['--ports']).show_ports).toBe(true)
	})

	it('reads --fix independently', () => {
		expect(doctor.parse_options(['--fix']).is_fix).toBe(true)
		expect(doctor.parse_options([]).is_fix).toBe(false)
	})
})

describe('plugin_line', () => {
	it('confirms a declared plugin', () => {
		expect(doctor_consumer.plugin_line(true)).toContain('✓')
	})

	it('warns and names josh sync when the plugin is not declared', () => {
		const line = doctor_consumer.plugin_line(false)

		expect(line).toContain('⚠')
		expect(line).toContain('pnpm josh sync')
	})
})

describe('hooks_path_line', () => {
	it('confirms git hooks when core.hooksPath is unset', () => {
		expect(doctor_consumer.hooks_path_line(undefined)).toContain('✓')
	})

	it('warns and names the value when core.hooksPath is set', () => {
		const line = doctor_consumer.hooks_path_line('.husky')

		expect(line).toContain('⚠')
		expect(line).toContain('.husky')
	})
})

describe('claude_md_line', () => {
	it('confirms a resolvable pointer', () => {
		expect(doctor_consumer.claude_md_line('ok')).toContain('✓')
	})

	it('warns to install when the pointer target is missing', () => {
		expect(doctor_consumer.claude_md_line(TARGET_MISSING)).toContain('pnpm install')
	})

	it('warns to init when CLAUDE.md is missing', () => {
		expect(doctor_consumer.claude_md_line('missing')).toContain('pnpm josh init')
	})
})

describe('secretlint_line', () => {
	it('confirms a runnable secretlint', () => {
		expect(doctor_consumer.secretlint_line(true)).toContain('✓')
	})

	it('warns when secretlint is not installed', () => {
		expect(doctor_consumer.secretlint_line(false)).toContain('⚠')
	})
})

describe('is_kit_consumer', () => {
	it('is true when the project declares the kit dependency', () => {
		const root = temporary_project()

		write_file(root, PACKAGE_JSON, JSON.stringify({ devDependencies: { [KIT]: '^1.0.0' } }))

		expect(doctor_consumer.is_kit_consumer(root)).toBe(true)
	})

	it('is false for kit itself', () => {
		const root = temporary_project()

		write_file(root, PACKAGE_JSON, JSON.stringify({ name: KIT }))

		expect(doctor_consumer.is_kit_consumer(root)).toBe(false)
	})

	it('is false for an unrelated project', () => {
		const root = temporary_project()

		write_file(root, PACKAGE_JSON, JSON.stringify({ name: 'other' }))

		expect(doctor_consumer.is_kit_consumer(root)).toBe(false)
	})
})

describe('is_plugin_declared', () => {
	it('is true when enabledPlugins names the kit plugin', () => {
		const root = temporary_project()

		write_file(root, SETTINGS_JSON, JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: true } }))

		expect(doctor_consumer.is_plugin_declared(root)).toBe(true)
	})

	it('is false when the settings file omits the plugin', () => {
		const root = temporary_project()

		write_file(root, SETTINGS_JSON, JSON.stringify({ enabledPlugins: {} }))

		expect(doctor_consumer.is_plugin_declared(root)).toBe(false)
	})
})

describe('claude_md_state', () => {
	it('is target-missing when the pointer resolves to an absent file', () => {
		const root = temporary_project()

		write_file(root, 'CLAUDE.md', `@node_modules/${KIT}/dist/CLAUDE.md\n`)

		expect(doctor_consumer.claude_md_state(root)).toBe(TARGET_MISSING)
	})

	it('is ok when the pointer target is installed', () => {
		const root = temporary_project()

		write_file(root, 'CLAUDE.md', `@node_modules/${KIT}/dist/CLAUDE.md\n`)
		write_file(root, `node_modules/${KIT}/dist/CLAUDE.md`, '# rules')

		expect(doctor_consumer.claude_md_state(root)).toBe('ok')
	})

	it('is missing when there is no CLAUDE.md', () => {
		expect(doctor_consumer.claude_md_state(temporary_project())).toBe('missing')
	})
})

describe('is_secretlint_runnable', () => {
	it('is true when the secretlint bin is present', () => {
		const root = temporary_project()

		write_file(root, path.join('node_modules', '.bin', 'secretlint'), '#!/bin/sh\n')

		expect(doctor_consumer.is_secretlint_runnable(root)).toBe(true)
	})

	it('is false when secretlint is not installed', () => {
		expect(doctor_consumer.is_secretlint_runnable(temporary_project())).toBe(false)
	})
})
