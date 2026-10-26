import type { CommandEntry } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { usage_span_placement } from './usage-span-placement'

type PlacedEntry = Pick<CommandEntry, 'category' | 'reference'>

const DEVELOPER_PAGE = 'docs/josh-commands.md'
const BACKLOG_PAGE = 'docs/josh-commands-backlog.md'
const AUTOMATION_PAGE = 'docs/josh-commands-automation.md'
const AUTOMATION: CommandEntry['reference'][1] = 'automation'
const AI_TOOLS: CommandEntry['category'] = 'AI tools'
const STASH_PUSH = 'stash:push'
const RULESET_CHECK = 'ruleset:check'
const RESERVED_RUN = 'reserved-run'

function section(name: string): string {
	return `### \`josh ${name}\`\n\n<!-- usage: ${name} -->\n<!-- /usage -->\n`
}

function pages(): ReadonlyMap<string, string> {
	return new Map([
		[DEVELOPER_PAGE, `# Dev\n\n## Development\n\n${section('lint')}\n## Project\n\n`],
		[
			BACKLOG_PAGE,
			`## Issues\n\n${section('issue:read')}\n#### Detail\n\nmore\n\n${section(STASH_PUSH)}`,
		],
		[
			AUTOMATION_PAGE,
			`## Maintenance\n\n${section(RULESET_CHECK)}\n## Git hooks\n\n${section(RESERVED_RUN)}`,
		],
	])
}

function entry(
	category: CommandEntry['category'],
	audience: CommandEntry['reference'][1],
): PlacedEntry {
	return { category, reference: ['', audience, ['none']] }
}

function placed(name: string, placed_entry: PlacedEntry): ReadonlyMap<string, string> {
	return usage_span_placement.place_missing_spans(pages(), { [name]: placed_entry })
}

describe('placing the span of a command no page renders yet', () => {
	it('puts a developer command on the developer page, after the commands sharing its prefix', () => {
		const text = placed('lint:new', entry('Development', 'developer')).get(DEVELOPER_PAGE)

		expect(text).toContain(`${section('lint')}\n${section('lint:new')}\n## Project`)
	})

	it('puts any other command after the last section of its prefix, keeping that section whole', () => {
		const text = placed('issue:new', entry(AI_TOOLS, AUTOMATION)).get(BACKLOG_PAGE)

		expect(text).toContain(`more\n\n${section('issue:new')}\n${section(STASH_PUSH)}`)
	})

	it('ends its category section on the automation page when no page shares its prefix', () => {
		const text = placed('fresh:new', entry('Maintenance', 'maintainer')).get(AUTOMATION_PAGE)

		expect(text).toContain(`${section(RULESET_CHECK)}\n${section('fresh:new')}\n## Git hooks`)
	})

	it('appends to the automation page when its category has no section there', () => {
		const text = placed('bump:new', entry('Versioning', AUTOMATION)).get(AUTOMATION_PAGE)

		expect(text?.endsWith(`${section(RESERVED_RUN)}\n${section('bump:new')}`)).toBe(true)
	})

	it('leaves every page as it was when each command already has a span', () => {
		expect(placed(STASH_PUSH, entry(AI_TOOLS, AUTOMATION))).toStrictEqual(pages())
	})
})
