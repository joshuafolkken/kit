import { readFileSync } from 'node:fs'
import { prettier_format_json } from '#scripts/config-merge/prettier-json-fixture'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const FORMAT_ON_SAVE_KEY = 'editor.formatOnSave'
const ESLINT_ENABLE_KEY = 'eslint.enable'
const SONARLINT_KEY = 'sonarlint.connectedMode.project'
const ESLINT_VALIDATE_KEY = 'eslint.validate'
const TERMINAL_LINE_HEIGHT_KEY = 'terminal.integrated.lineHeight'
const KIT_VSCODE_SETTINGS_PATH = '.vscode/settings.json'

describe('strip_kit_only_vscode_settings', () => {
	it('removes kit-only keys while preserving other settings', () => {
		const result = init_logic.strip_kit_only_vscode_settings({
			[FORMAT_ON_SAVE_KEY]: true,
			[SONARLINT_KEY]: { connectionId: 'joshuafolkken', projectKey: 'joshuafolkken_kit' },
		})

		expect(result).not.toHaveProperty(SONARLINT_KEY)
		expect(result[FORMAT_ON_SAVE_KEY]).toBe(true)
	})

	it('returns an equivalent object when no kit-only keys are present', () => {
		const settings = { [FORMAT_ON_SAVE_KEY]: true, [ESLINT_ENABLE_KEY]: true }

		expect(init_logic.strip_kit_only_vscode_settings(settings)).toEqual(settings)
	})

	// joshuafolkken/kit#3498: run:board's gauges draw a centered square that leaves a gap between
	// stacked bars at VS Code's default line height of 1, so no line height reaches consumers.
	it('distributes no terminal line height to consumers', () => {
		const raw = readFileSync(KIT_VSCODE_SETTINGS_PATH, 'utf8')
		const result = init_logic.strip_kit_only_vscode_settings_content(raw)

		expect(result).not.toContain(TERMINAL_LINE_HEIGHT_KEY)
	})
})

describe('strip_kit_only_vscode_settings_content', () => {
	it('strips kit-only keys from raw JSON content', () => {
		const raw = JSON.stringify({ [FORMAT_ON_SAVE_KEY]: true, [SONARLINT_KEY]: { enabled: true } })
		const result = init_logic.strip_kit_only_vscode_settings_content(raw)

		expect(result).not.toContain('sonarlint')
		expect(result).toContain(FORMAT_ON_SAVE_KEY)
	})

	it('returns the raw content verbatim when no kit-only keys are present', () => {
		const raw = '{ "editor.formatOnSave": true }'

		expect(init_logic.strip_kit_only_vscode_settings_content(raw)).toBe(raw)
	})

	// The stripped file is written straight into the consumer's project, so it has to survive their
	// own `prettier --check`. prettier reads `.vscode/settings.json` with the `json` parser, which
	// keeps a short array inline — plain `JSON.stringify` expanded `eslint.validate` and produced a
	// file that failed formatting on arrival. Same class as kit#797 on the package.json side.
	it('emits a file real prettier leaves unchanged', async () => {
		const raw = JSON.stringify({
			[FORMAT_ON_SAVE_KEY]: true,
			[ESLINT_VALIDATE_KEY]: ['javascript', 'typescript'],
			[SONARLINT_KEY]: { enabled: true },
		})
		const result = init_logic.strip_kit_only_vscode_settings_content(raw)

		expect(result).toContain(`"${ESLINT_VALIDATE_KEY}": ["javascript", "typescript"]`)
		expect(await prettier_format_json(result)).toBe(result)
	})
})
