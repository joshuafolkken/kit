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
	// The CLI and the rule preset are resolved from the consumer project, so a partial
	// install leaves the pre-commit hook failing with "Cannot find module".
	it('adds both the CLI and the rule preset when neither is present', () => {
		const deps = parse_merged_deps('{"devDependencies":{}}')

		expect(Object.keys(deps)).toHaveLength(2)
		expect(deps[SECRETLINT_KEY]).toBeDefined()
		expect(deps[PRESET_ID]).toBeDefined()
	})

	it('adds the dependencies when devDependencies is absent entirely', () => {
		expect(parse_merged_deps('{"name":"consumer"}')[SECRETLINT_KEY]).toBeDefined()
	})

	it('pins the preset to the same major as the CLI', () => {
		const deps = parse_merged_deps('{}')

		expect(deps[PRESET_ID]).toBe(deps[SECRETLINT_KEY])
	})

	it('preserves a version the consumer already pinned', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^12.0.0"}}`

		expect(parse_merged_deps(content)[SECRETLINT_KEY]).toBe('^12.0.0')
	})

	it('returns content untouched when both entries already exist', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^13.0.2","${PRESET_ID}":"^13.0.2"}}`

		expect(init_logic_secretlint.merge_secretlint_development_deps(content)).toBe(content)
	})

	it('keeps unrelated devDependencies intact', () => {
		// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature requires bracket notation for Record type
		expect(parse_merged_deps('{"devDependencies":{"vitest":"^4.0.0"}}')['vitest']).toBe('^4.0.0')
	})
})
