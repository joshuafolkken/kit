import { readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { init_logic_secretlint } from './init-logic-secretlint'

const PRESET_ID = '@secretlint/secretlint-rule-preset-recommend'
const SECRETLINT_KEY = 'secretlint'

interface SecretlintConfig {
	rules: Array<{ id: string }>
}

interface PackageJson {
	devDependencies: Record<string, string>
}

function read_kit_manifest(): PackageJson {
	return JSON.parse(readFileSync(package_file('package.json'), 'utf8')) as PackageJson
}

function parse_generated_config(): SecretlintConfig {
	return JSON.parse(init_logic_secretlint.generate_secretlint_config()) as SecretlintConfig
}

function parse_merged_deps(content: string): Record<string, string> {
	const merged = init_logic_secretlint.merge_secretlint_development_deps(content)

	return (JSON.parse(merged) as PackageJson).devDependencies
}

describe('init_logic_secretlint.generate_secretlint_config', () => {
	it('emits JSON enabling the recommend preset', () => {
		expect(parse_generated_config().rules).toStrictEqual([{ id: PRESET_ID }])
	})

	it('ends with a trailing newline', () => {
		expect(init_logic_secretlint.generate_secretlint_config().endsWith('}\n')).toBe(true)
	})

	it('reports the config filename secretlint discovers by default', () => {
		expect(init_logic_secretlint.get_secretlint_config_filename()).toBe('.secretlintrc.json')
	})
})

describe('init_logic_secretlint.merge_secretlint_development_deps', () => {
	// The CLI is resolved from the consumer project; since secretlint v14 it carries the recommend
	// preset itself, so the deprecated preset package is never added.
	it('adds only the CLI when it is absent', () => {
		const deps = parse_merged_deps('{"devDependencies":{}}')

		expect(Object.keys(deps)).toStrictEqual([SECRETLINT_KEY])
		expect(deps[PRESET_ID]).toBeUndefined()
	})

	it('adds the dependencies when devDependencies is absent entirely', () => {
		expect(parse_merged_deps('{"name":"consumer"}')[SECRETLINT_KEY]).toBeDefined()
	})

	it('preserves a version the consumer already pinned', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^12.0.0"}}`

		expect(parse_merged_deps(content)[SECRETLINT_KEY]).toBe('^12.0.0')
	})

	it('returns content untouched when the CLI already exists', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^14.0.0"}}`

		expect(init_logic_secretlint.merge_secretlint_development_deps(content)).toBe(content)
	})

	it('drops the retired preset package and moves the CLI to the version kit carries', () => {
		const kit = read_kit_manifest()
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^13.1.0","${PRESET_ID}":"^13.1.0"}}`
		const deps = parse_merged_deps(content)

		expect(deps[PRESET_ID]).toBeUndefined()
		expect(deps[SECRETLINT_KEY]).toBe(kit.devDependencies[SECRETLINT_KEY])
	})

	it("adds the version kit's own devDependencies carry", () => {
		const kit = read_kit_manifest()
		const deps = parse_merged_deps('{}')

		expect(deps[SECRETLINT_KEY]).toBe(kit.devDependencies[SECRETLINT_KEY])
		expect(kit.devDependencies[PRESET_ID]).toBeUndefined()
	})

	it('keeps unrelated devDependencies intact', () => {
		expect(parse_merged_deps('{"devDependencies":{"vitest":"^4.0.0"}}')['vitest']).toBe('^4.0.0')
	})
})
