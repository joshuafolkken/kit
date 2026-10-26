import { readFileSync } from 'node:fs'
import { document_scan } from '#scripts/document/document-scan'
import { command_usage } from '#scripts/josh/command-usage'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { generate_command_usage } from '#tools/document/generate-command-usage'
import { describe, expect, it } from 'vitest'

const STALE_PAGE = '### `josh lint`\n\n<!-- usage: lint -->\n\nstale\n\n<!-- /usage -->\n\nprose\n'
const DEVELOPER_PAGE = 'docs/josh-commands.md'

function sorted(names: ReadonlyArray<string>): Array<string> {
	return names.toSorted((left, right) => left.localeCompare(right))
}

// A command's audience decides its page: the commands a person types (`developer`) render on the
// developer reference, so the audience the catalog prints and the page a reader is sent to cannot
// disagree (joshuafolkken/kit#3278).
function developer_commands(): Array<string> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => entry.reference[1] === 'developer')
		.map(([name]) => name)
}

function page_text(page: string): string {
	return readFileSync(generate_command_usage.page_path(page), 'utf8')
}

// The headings stay hand-written, so a section heading left behind on the wrong page carries no span
// for the span checks to catch; a heading may name only the commands its page renders, once each, so
// repeats are kept for a stale second section to surface as a duplicate. A heading naming a command
// with arguments (`josh epic --add`) is a subsection of that command's section, not a section.
function heading_commands(text: string): Array<string> {
	const headings = text
		.split('\n')
		.filter((line) => /^#{2,4} /u.test(line) && !/`josh [^`\s]+ [^`]*`/u.test(line))

	return headings.flatMap((line) => document_scan.command_references(line))
}

// A stale page's failure names the command that regenerates it (#4784).
function expect_page_current(text: string): void {
	const message = `the usage spans are stale — run \`${generate_command_usage.REGENERATE_COMMAND}\``

	expect(generate_command_usage.fill_usage_blocks(text), message).toBe(text)
}

describe('generate command usage', () => {
	it('replaces a usage span with the registered usage and keeps the prose around it', () => {
		const filled = generate_command_usage.fill_usage_blocks(STALE_PAGE)

		expect(filled).toBe(
			`### \`josh lint\`\n\n<!-- usage: lint -->\n\n${COMMAND_MAP['lint']?.description ?? ''}.\n\n${command_usage.format_usage('lint') ?? ''}\n\n<!-- /usage -->\n\nprose\n`,
		)
	})

	it('ends a summary with a period when it has no closing punctuation', () => {
		expect(generate_command_usage.as_sentence('Run lint')).toBe('Run lint.')
	})

	it.each(['Done.', 'Is it held?'])('keeps the closing punctuation of %j', (text) => {
		expect(generate_command_usage.as_sentence(text)).toBe(text)
	})

	it('refuses a span naming a command with no registered usage', () => {
		expect(() =>
			generate_command_usage.fill_usage_blocks('<!-- usage: not-a-command -->\n<!-- /usage -->'),
		).toThrow('josh not-a-command')
	})

	it.each(generate_command_usage.USAGE_PAGES)('%s is up to date', (page) => {
		expect_page_current(page_text(page))
	})

	it('names the regeneration command when a page is stale', () => {
		expect(() => {
			expect_page_current(STALE_PAGE)
		}).toThrow('run `pnpm josh command:derive`')
	})
})

// The spans are the reference's sections: every command has one, on exactly one page, and a page
// decides which commands it renders — the developer page holding the developer audience (#3981, #4185).
describe('the usage spans cover the command map', () => {
	it('gives every command map entry a span on exactly one page', () => {
		const spans = generate_command_usage.USAGE_PAGES.flatMap((page) =>
			generate_command_usage.usage_spans(page_text(page)),
		)

		const message = `a command has no usage span, or a span names no command — run \`${generate_command_usage.REGENERATE_COMMAND}\``

		expect(sorted(spans), message).toEqual(sorted(Object.keys(COMMAND_MAP)))
	})

	it('renders exactly the developer-audience commands on the developer page', () => {
		const spans = generate_command_usage.usage_spans(page_text(DEVELOPER_PAGE))

		expect(sorted(spans)).toEqual(sorted(developer_commands()))
	})
})

function rendered_span(name: string, usage: string): string {
	const summary = generate_command_usage.as_sentence(COMMAND_MAP[name]?.description ?? '')

	return `<!-- usage: ${name} -->\n\n${summary}\n\n${usage}\n\n<!-- /usage -->`
}

function all_pages_text(): string {
	return generate_command_usage.USAGE_PAGES.map((page) => page_text(page)).join('\n')
}

// `josh help <command>` and the page's span end in one usage block, read from the command's entry.
describe('josh help and the page render one usage', () => {
	const pages = all_pages_text()

	it.each(Object.keys(COMMAND_MAP))('%s', (name) => {
		const usage = command_usage.format_usage(name) ?? ''

		expect(command_usage.format_command_help(name)?.endsWith(`\n\n${usage}`)).toBe(true)
		expect(pages).toContain(rendered_span(name, usage))
	})
})

describe('the section headings match the usage spans', () => {
	it('reads every command a grouped heading names and none from the prose', () => {
		const text = '### `josh run:hold` / `josh run:release`\n\nthen run `josh gate`'

		expect(heading_commands(text)).toEqual(['run:hold', 'run:release'])
	})

	it('keeps a command headed twice so a stale second section is caught', () => {
		const text = '### `josh gate`\n\nprose\n\n### `josh gate`'

		expect(heading_commands(text)).toEqual(['gate', 'gate'])
	})

	it('reads a heading naming a command with arguments as a subsection of that command', () => {
		const text = '### `josh epic`\n\n#### `josh epic --add` — insert children'

		expect(heading_commands(text)).toEqual(['epic'])
	})

	it.each(generate_command_usage.USAGE_PAGES)(
		'%s heads its sections with exactly the commands its spans render',
		(page) => {
			const text = page_text(page)

			expect(sorted(heading_commands(text))).toEqual(
				sorted(generate_command_usage.usage_spans(text)),
			)
		},
	)
})

// The summary under a heading is the generated span's description; prose written between the heading
// and its first span is a hand-written restatement of it (#4162).
function is_command_heading(line: string): boolean {
	return heading_commands(line).length > 0
}

function next_content_line(lines: ReadonlyArray<string>, index: number): string {
	return lines.slice(index + 1).find((line) => line.trim() !== '') ?? ''
}

function headings_with_prose(text: string): Array<string> {
	const lines = text.split('\n')

	return lines.filter(
		(line, index) =>
			is_command_heading(line) && !next_content_line(lines, index).startsWith('<!-- usage: '),
	)
}

describe('a section opens with its generated summary', () => {
	it('reports a heading followed by prose before its span', () => {
		const text = '### `josh gate`\n\nRun the checks.\n\n<!-- usage: gate -->\n<!-- /usage -->'

		expect(headings_with_prose(text)).toEqual(['### `josh gate`'])
	})

	it('accepts a heading followed directly by its span', () => {
		expect(headings_with_prose('### `josh gate`\n\n<!-- usage: gate -->')).toEqual([])
	})

	it.each(generate_command_usage.USAGE_PAGES)(
		'%s carries no hand-written summary between a heading and its span',
		(page) => {
			expect(headings_with_prose(page_text(page))).toEqual([])
		},
	)
})

describe('the developer audience', () => {
	it.each(['latest', 'latest:corepack', 'latest:update', 'overrides'])(
		'treats %s as a command a person types',
		(name) => {
			expect(developer_commands()).toContain(name)
		},
	)
})
