import { readFileSync } from 'node:fs'
import { command_usage } from '#scripts/josh/command-usage'
import { describe, expect, it } from 'vitest'
import { generate_command_usage } from './generate-command-usage'

const STALE_PAGE = '### `josh lint`\n\n<!-- usage: lint -->\n\nstale\n\n<!-- /usage -->\n\nprose\n'

describe('generate command usage', () => {
	it('replaces a usage span with the registered usage and keeps the prose around it', () => {
		const filled = generate_command_usage.fill_usage_blocks(STALE_PAGE)

		expect(filled).toBe(
			`### \`josh lint\`\n\n<!-- usage: lint -->\n\n${command_usage.format_usage('lint') ?? ''}\n\n<!-- /usage -->\n\nprose\n`,
		)
	})

	it('refuses a span naming a command with no registered usage', () => {
		expect(() =>
			generate_command_usage.fill_usage_blocks('<!-- usage: stop:guard -->\n<!-- /usage -->'),
		).toThrow('josh stop:guard')
	})

	it.each(generate_command_usage.USAGE_PAGES)(
		'%s is up to date — run `tsx scripts/document/generate-command-usage.ts`',
		(page) => {
			const text = readFileSync(generate_command_usage.page_path(page), 'utf8')

			expect(generate_command_usage.fill_usage_blocks(text)).toBe(text)
		},
	)
})
