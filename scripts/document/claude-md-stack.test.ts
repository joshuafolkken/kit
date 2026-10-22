import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CLAUDE_MD = path.join(import.meta.dirname, '..', '..', 'CLAUDE.md')

function read_claude_md(): string {
	return readFileSync(CLAUDE_MD, 'utf8')
}

describe('distributed CLAUDE.md', () => {
	it('declares no tech stack, since the consumer package.json already states it', () => {
		expect(read_claude_md()).not.toMatch(/^Stack:/mu)
	})
})
