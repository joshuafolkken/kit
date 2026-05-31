import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_CI_YML = path.join(PACKAGE_ROOT, 'templates/workflows/ci.yml')
const BUILD_STEP = 'run: pnpm build'
const ESLINT_STEP = 'run: pnpm exec eslint'

function step_index(file_path: string, needle: string): number {
	const lines = readFileSync(file_path, 'utf8').split('\n')

	return lines.findIndex((line) => line.includes(needle))
}

describe('ci.yml build order (templates/workflows/ci.yml)', () => {
	it('builds dist/ before the eslint step so consumers can type-aware-lint against dist', () => {
		const build_index = step_index(TEMPLATE_CI_YML, BUILD_STEP)
		const eslint_index = step_index(TEMPLATE_CI_YML, ESLINT_STEP)

		expect(build_index).toBeGreaterThanOrEqual(0)
		expect(eslint_index).toBeGreaterThanOrEqual(0)
		expect(build_index).toBeLessThan(eslint_index)
	})
})
