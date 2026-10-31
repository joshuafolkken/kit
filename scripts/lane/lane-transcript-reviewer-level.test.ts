import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { review_attest } from '#scripts/review/review-attest'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { describe, expect, it } from 'vitest'
import { lane_transcript_calls } from './lane-transcript-calls'

// joshuafolkken/kit#5555: the prompt a reviewer is launched with opens with the brief's level, so the
// transcript reader — and `lane:breakdown`'s `round 1 · <level>` row — carries it.

const CODE_SLOT = review_attest.REVIEW_SLOT.CODE
const ISSUE = '5555'

function brief_file(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'lane-reviewer-level-'))
	const file = path.join(directory, 'josh-ship-review-brief-code.md')

	writeFileSync(file, 'medium\n## Rubric\n')

	return file
}

function agent_line(prompt: string): string {
	const input = { subagent_type: 'reviewer', prompt }
	const content = [{ type: 'tool_use', id: 'a', name: 'Agent', input }]

	return JSON.stringify({ timestamp: '2026-10-31T00:00:00Z', message: { content } })
}

function subagent_of(prompt: string): unknown {
	const [parsed] = lane_transcript_calls.parse({ session_id: 's', lane: '1' }, agent_line(prompt))

	return parsed?.subagent
}

describe('reviewer launch prompts — the level on the first line', () => {
	it.each([
		['round 1', run_ship_review.reviewer_prompt, undefined],
		['the read-only round 1', run_ship_review.report_prompt, undefined],
		['round 2', run_ship_review.verification_prompt, 'round 2'],
	])('%s opens with the level in one launch-safe line', (_round, prompt_of, pass) => {
		const prompt = prompt_of(brief_file(), CODE_SLOT, ISSUE)

		expect(prompt.startsWith('medium — Review this checkout')).toBe(true)
		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(subagent_of(prompt)).toStrictEqual({
			type: 'reviewer',
			model: undefined,
			level: 'medium',
			pass,
		})
	})

	it('opens the printed round-1 prompt with the level too', () => {
		const opening = run_ship_review.round_one_opening(brief_file())

		expect(subagent_of(opening)).toMatchObject({ level: 'medium' })
	})
})
