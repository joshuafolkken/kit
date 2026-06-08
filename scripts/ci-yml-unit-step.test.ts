import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_CI_YML = path.join(PACKAGE_ROOT, 'templates/workflows/ci.yml')

function ci_yml_contents(): string {
	return readFileSync(TEMPLATE_CI_YML, 'utf8')
}

describe('ci.yml unit step (templates/workflows/ci.yml)', () => {
	it('routes the unit test step through the guarded josh test:unit command', () => {
		expect(ci_yml_contents()).toContain('run: pnpm josh test:unit')
	})

	it('does not invoke vitest directly so a fresh project can skip gracefully', () => {
		expect(ci_yml_contents()).not.toContain('pnpm exec vitest run')
	})
})
