import { readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface LefthookCommand {
	run?: string
}

interface LefthookHook {
	commands?: Record<string, LefthookCommand>
}

type LefthookConfig = Record<string, LefthookHook>

const SVELTEKIT_LEFTHOOK = path.join('lefthook', 'sveltekit.yml')
const PRE_PUSH = 'pre-push'
const TEST_E2E = 'test-e2e'

function load_test_e2e_command(relative_path: string): LefthookCommand | undefined {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
	const config = yaml.load(content) as LefthookConfig

	return config[PRE_PUSH]?.commands?.[TEST_E2E]
}

describe('lefthook/sveltekit.yml pre-push e2e gate', () => {
	const test_e2e = load_test_e2e_command(SVELTEKIT_LEFTHOOK)

	it('defines a test-e2e pre-push command', () => {
		expect(test_e2e).toBeDefined()
	})

	it('routes through the guarded josh test:e2e command', () => {
		expect(test_e2e?.run).toBe('pnpm josh test:e2e')
	})

	it('does not invoke playwright directly so the optional peer stays optional', () => {
		expect(test_e2e?.run).not.toContain('playwright test')
	})
})
