import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { refactor_lint } from './refactor-lint'

vi.setConfig({ testTimeout: SUITE_TIMEOUT_MS })

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RULE = '@typescript-eslint/naming-convention'
const NAMING_CATEGORY = 'naming-convention'
const EXTERNAL_FILES = ['scripts/ci/ci-yml-fixture.ts', 'scripts/josh/josh-commands-maintenance.ts']
const PROBE_FILE = 'probe.ts'
const PROBE_SOURCE = [
	`// eslint-disable-next-line ${RULE} -- External workflow key`,
	`const workflow = { 'continue-on-error': true }`,
	`// eslint-disable-next-line ${RULE} -- External command name`,
	`const commands = { 'refactor:scan': true }`,
	'const invalidName = 1',
].join('\n')
const PROBE_CONFIG = `
import ts from '${import.meta.resolve('typescript-eslint')}'
import { naming_convention_rules } from '${new URL('../../eslint/rules/naming-convention.js', import.meta.url).href}'
export default [{ files: ['**/*.ts'], languageOptions: { parser: ts.parser,
parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
plugins: { '@typescript-eslint': ts.plugin }, rules: naming_convention_rules }]
`

function probe_checkout(): string {
	const temporary_root = mkdtempSync(path.join(tmpdir(), 'kit-refactor-parity-'))
	const root = realpathSync(temporary_root)

	onTestFinished(() => {
		rmSync(root, { recursive: true, force: true })
	})
	writeFileSync(path.join(root, 'eslint.config.mjs'), PROBE_CONFIG)
	symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir')
	writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: [PROBE_FILE] }))
	writeFileSync(path.join(root, PROBE_FILE), PROBE_SOURCE)

	return root
}

describe('refactor lint gate parity', () => {
	it('honors real workflow and command-map naming exceptions', async () => {
		const categories = await refactor_lint.scan_categories(EXTERNAL_FILES, ROOT)

		expect(
			categories.find((category) => category.key === NAMING_CATEGORY)?.candidates,
		).toStrictEqual([])
	})

	it('still detects a real naming violation beside valid external keys', async () => {
		const categories = await refactor_lint.scan_categories([PROBE_FILE], probe_checkout())

		expect(
			categories.find((category) => category.key === NAMING_CATEGORY)?.candidates,
		).toStrictEqual([{ location: 'probe.ts:5', rule: RULE }])
	})
})
