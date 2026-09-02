import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claude_settings_fixture } from './claude-settings-fixture'

// The cap on what one command's output contributes to a run's context (joshuafolkken/kit#1173).
//
// Claude Code middle-truncates a Bash result longer than `BASH_MAX_OUTPUT_LENGTH`, so declaring it
// in the distributed settings file puts the limit in the harness rather than in the judgement of
// whichever agent typed the command. The two numbers below are the harness's own, read out of the
// `claude` binary: `default:30000, upperLimit:150000`.
//
// **Declaring it is not enough, which is why the default is asserted against rather than quoted.**
// Across 25 sessions and 1,848 Bash results, not one exceeded 30,000 characters — the harness cap
// existed and never once fired. A value at or above the default is therefore indistinguishable from
// no cap at all, and a test that only checked for the key's presence would pass in exactly the state
// this issue was filed about.

const HARNESS_DEFAULT_CHARS = 30_000
const HARNESS_UPPER_LIMIT_CHARS = 150_000

const DOC_PATH = fileURLToPath(
	new URL('../prompts/collaboration-workflow/output-bounds.md', import.meta.url),
)

function declared_cap(): string | undefined {
	return claude_settings_fixture.load_settings().env.BASH_MAX_OUTPUT_LENGTH
}

function cap_chars(): number {
	return Number(declared_cap())
}

describe('bash output cap', () => {
	it('is declared in the distributed settings file', () => {
		expect(declared_cap()).toBeDefined()
	})

	it('is a positive whole number of characters', () => {
		const cap = cap_chars()

		expect(Number.isSafeInteger(cap)).toBe(true)
		expect(cap).toBeGreaterThan(0)
	})

	it('binds, rather than sitting at or above the harness default', () => {
		expect(cap_chars()).toBeLessThan(HARNESS_DEFAULT_CHARS)
	})

	it('stays within the largest value the harness accepts', () => {
		expect(cap_chars()).toBeLessThanOrEqual(HARNESS_UPPER_LIMIT_CHARS)
	})

	// The document carries the reasoning for this particular number, so a settings change that leaves
	// the document behind makes the recorded rationale describe a cap nobody is running.
	it('is the same number the canonical topic document states', () => {
		const topic_text = readFileSync(DOC_PATH, 'utf8')

		expect(topic_text).toContain(`"BASH_MAX_OUTPUT_LENGTH": "${String(declared_cap())}"`)
	})
})
