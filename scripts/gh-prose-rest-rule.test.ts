import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1565: `gh-document-guard.test.ts` scans fenced code blocks only, and that scope
// is deliberate — 39 of the 41 prose occurrences of a `gh` subcommand are a prohibition being quoted
// or a record of what the CLI can do, so a matcher over prose would ship as an allowlist of its own
// false positives. What the fence boundary cannot see is a sentence that *instructs* without being
// runnable, and two of those had survived in shipped documents. The rule that covers them is prose
// itself, so prose is what this suite pins: a document that keeps the rule and drops any part of it
// describes a workflow that goes back to being 403 in a cloud session.

const RULES = 'CLAUDE.md'
const TOPIC = 'prompts/collaboration-workflow/gh-rest.md'
const INDEX = 'prompts/collaboration-workflow.md'
const CLOUD_DOC = 'docs/cloud-session.md'
const REVIEW = 'prompts/review.md'
const EPIC_SKILL = '.claude/skills/epic-commands/SKILL.md'
const BATCHING = 'prompts/collaboration-workflow/turn-batching.md'

const RULE_MARKERS: ReadonlyArray<[string, string]> = [
	[RULES, 'GitHub operations are `gh api` (REST), never `gh issue` / `gh pr`'],
	[RULES, 'instructing prose included'],
	[TOPIC, '**GitHub への操作は `gh api`（REST）で書く。'],
	[TOPIC, '読み手に 実行を指示する形であれば REST で書く。'],
]

describe('the REST rule is written down where an agent reads rules', () => {
	it.each(RULE_MARKERS)('%s carries the rule', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	it('is reachable from the collaboration-workflow index', () => {
		expect(read_unwrapped(INDEX)).toContain('gh-rest.md')
	})
})

// Both exceptions have to survive together. Without the first, an agent refuses `gh auth token` and
// `josh latest` loses its registry credential; without the second, someone "fixes"
// `gh pr merge --auto` in a workflow into a REST call that does not exist.
const EXCEPTION_MARKERS: ReadonlyArray<[string, string]> = [
	[TOPIC, '`gh auth token`'],
	[TOPIC, 'GitHub Actions のワークフロー'],
	[CLOUD_DOC, '**`gh auth token`**'],
	[CLOUD_DOC, '**GitHub Actions workflows.**'],
]

describe('the two exceptions', () => {
	it.each(EXCEPTION_MARKERS)('%s names them', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

// The half a reader most often draws the wrong conclusion from: migrating to `gh api` removed the
// GraphQL dependency, not the binary one, and a container without `gh` was measured.
const BINARY_MARKERS: ReadonlyArray<[string, string]> = [
	[RULES, '`gh` must be installed; environments with none exist'],
	[TOPIC, 'REST 化は `gh` を不要にしない'],
	[TOPIC, 'Could not read this repository from git remote'],
	[CLOUD_DOC, 'REST does not make `gh` optional'],
	[CLOUD_DOC, 'gh CLI is not installed'],
]

describe('REST does not make the binary optional', () => {
	it.each(BINARY_MARKERS)('%s says so', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

// The three sentences joshuafolkken/kit#1565 rewrote. Asserting their absence is what keeps the fix
// from being reverted by a later edit that only reads the surrounding paragraph.
const RETIRED_INSTRUCTIONS: ReadonlyArray<[string, string]> = [
	[REVIEW, 'gh issue list --label review-round2-skipped'],
	[EPIC_SKILL, '`gh issue comment` on each child'],
	[BATCHING, '`gh issue view`'],
]

describe('no shipped document instructs a GraphQL-backed subcommand in prose', () => {
	it.each(RETIRED_INSTRUCTIONS)('%s no longer says it', (document_path, retired) => {
		expect(read_unwrapped(document_path)).not.toContain(retired)
	})

	it('replaces the round-2 count with the REST form', () => {
		expect(read_unwrapped(REVIEW)).toContain('labels=review-round2-skipped&state=all')
	})

	it('replaces the child comment with the REST form', () => {
		expect(read_unwrapped(EPIC_SKILL)).toContain('gh api repos/{owner}/{repo}/issues/<N>/comments')
	})
})

// The preconditions a cloud session fails on. Each one cost a measured session to find, and a
// document that drops one sends the next reader back through the same investigation.
const CLOUD_MARKERS: ReadonlyArray<string> = [
	'api.osv.dev',
	'osv-vulnerabilities.storage.googleapis.com',
	'release-assets.githubusercontent.com',
	'api.telegram.org',
	'pnpm josh audit:provision',
	'22 s first time',
	'213 MB',
	'`JOSH_LANE_LIMIT`',
	'No `.env` file is needed',
	'joshuafolkken/kit#1020',
	'joshuafolkken/kit#1022',
	'run:liveness',
]

describe('the cloud-session preconditions are documented', () => {
	it.each(CLOUD_MARKERS)('records %s', (marker) => {
		expect(read_unwrapped(CLOUD_DOC)).toContain(marker)
	})
})
