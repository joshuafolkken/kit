import { readFileSync } from 'node:fs'
import { claude_installer } from '#scripts/lib/claude-installer'
import { shell_quote } from '#scripts/lib/shell-quote'
import { describe, expect, it } from 'vitest'
import { fresh_machine_script } from './fresh-machine-script'
import { fresh_machine_spec } from './fresh-machine-spec'

describe('fresh machine Claude bootstrap', () => {
	it.each(['kit-test-backlogrun', 'kit-test-backlogrun-python'])(
		'uses the shared pinned installer for %s (ac-780d38c0)',
		(name) => {
			const json = readFileSync(new URL(`specs/${name}.json`, import.meta.url), 'utf8')
			const scenario = fresh_machine_spec.parse(json)
			const script = fresh_machine_script.build(scenario)

			expect(scenario.requires_claude).toBe(true)
			expect(script).toContain(shell_quote.single_quoted(claude_installer.command()))
			expect(script).not.toContain('https://claude.ai/install.sh')
			expect(script).not.toMatch(/curl[^\n]*\|\s*bash/u)
		},
	)

	it('does not download Claude for scenarios without Claude credentials', () => {
		const scenario = fresh_machine_spec.define({ name: 'kit-test', commands: ['echo hello'] })

		expect(fresh_machine_script.build(scenario)).not.toContain('claude-code-releases')
	})
})
