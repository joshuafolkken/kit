import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3070 folded `docs/scripts-ai.md` into the notification how-to and the
// environment-variable reference, so the Telegram credential steps are written in one place only.
const DOCS_DIRECTORY = 'docs'
const SETUP_GUIDE = 'docs/how-to/set-up-notifications.md'
const BOT_FATHER_STEP = '/newbot'
const CHAT_ID_STEP = '/getUpdates'

function markdown_documents(): Array<string> {
	return readdirSync(package_file(DOCS_DIRECTORY), { encoding: 'utf8', recursive: true })
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => `${DOCS_DIRECTORY}/${entry}`)
}

function documents_containing(text: string): Array<string> {
	return markdown_documents().filter((path) =>
		readFileSync(package_file(path), 'utf8').includes(text),
	)
}

describe('notification setup documents', () => {
	it('no longer ships the former scripts-ai.md page', () => {
		expect(existsSync(package_file('docs/scripts-ai.md'))).toBe(false)
	})

	it.each([BOT_FATHER_STEP, CHAT_ID_STEP])('writes the %s step only in the setup guide', (step) => {
		expect(documents_containing(step)).toEqual([SETUP_GUIDE])
	})
})
