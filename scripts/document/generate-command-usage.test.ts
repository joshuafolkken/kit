import { readFileSync } from 'node:fs'
import { command_usage } from '#scripts/josh/command-usage'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { generate_command_usage } from './generate-command-usage'

const STALE_PAGE = '### `josh lint`\n\n<!-- usage: lint -->\n\nstale\n\n<!-- /usage -->\n\nprose\n'
const DEVELOPER_PAGE = 'docs/josh-commands.md'

function sorted(names: ReadonlyArray<string>): Array<string> {
	return names.toSorted((left, right) => left.localeCompare(right))
}

function page_text(page: string): string {
	return readFileSync(generate_command_usage.page_path(page), 'utf8')
}

describe('generate command usage', () => {
	it('replaces a usage span with the registered usage and keeps the prose around it', () => {
		const filled = generate_command_usage.fill_usage_blocks(STALE_PAGE)

		expect(filled).toBe(
			`### \`josh lint\`\n\n<!-- usage: lint -->\n\n${command_usage.format_usage('lint') ?? ''}\n\n<!-- /usage -->\n\nprose\n`,
		)
	})

	it('refuses a span naming a command with no registered usage', () => {
		expect(() =>
			generate_command_usage.fill_usage_blocks('<!-- usage: not-a-command -->\n<!-- /usage -->'),
		).toThrow('josh not-a-command')
	})

	it.each(generate_command_usage.USAGE_PAGES)(
		'%s is up to date — run `tsx scripts/document/generate-command-usage.ts`',
		(page) => {
			const text = page_text(page)

			expect(generate_command_usage.fill_usage_blocks(text)).toBe(text)
		},
	)
})

// The spans are the reference's sections: every command has one, on the page its usage table is tied
// to, so a command with no span or a table rendered on the wrong page fails here (#3981).
describe('the usage spans cover the command map', () => {
	it('reports a command of the page tables that has no span', () => {
		const text = '<!-- usage: lint -->\n<!-- /usage -->'

		expect(generate_command_usage.span_mismatch(DEVELOPER_PAGE, text).missing).toContain('gate')
	})

	it('reports a span on a page whose tables do not hold that command', () => {
		const text = '<!-- usage: followup -->\n<!-- /usage -->'

		expect(generate_command_usage.span_mismatch(DEVELOPER_PAGE, text).misplaced).toEqual([
			'followup',
		])
	})

	it.each(generate_command_usage.USAGE_PAGES)(
		'%s carries a span for exactly the commands of its tables',
		(page) => {
			expect(generate_command_usage.span_mismatch(page, page_text(page))).toEqual({
				missing: [],
				misplaced: [],
			})
		},
	)

	it('gives every command map entry a span on exactly one page', () => {
		const spans = generate_command_usage.USAGE_PAGES.flatMap((page) =>
			generate_command_usage.usage_spans(page_text(page)),
		)

		expect(sorted(spans)).toEqual(sorted(Object.keys(COMMAND_MAP)))
	})

	it('renders exactly the developer-audience commands on the developer page', () => {
		const developer = Object.entries(COMMAND_MAP)
			.filter(([, entry]) => entry.reference[1] === 'developer')
			.map(([name]) => name)

		expect(sorted(command_usage.page_commands(DEVELOPER_PAGE))).toEqual(sorted(developer))
	})
})
