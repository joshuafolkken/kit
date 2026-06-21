import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function read_workflow(relative_path: string): string {
	return readFileSync(fileURLToPath(new URL(relative_path, import.meta.url)), 'utf8')
}

function count_occurrences(content: string, needle: string): number {
	return content.split(needle).length - 1
}

const AUTO_TAG_PATH = '../../.github/workflows/auto-tag.yml'
const PRODUCTION_PATH = '../../.github/workflows/production.yml'
const CI_TEMPLATE_PATH = '../../templates/workflows/ci.yml'

describe('auto-tag.yml — remote tag awareness', () => {
	it('fetches remote tags before checking whether the tag exists', () => {
		expect(read_workflow(AUTO_TAG_PATH)).toContain('git fetch origin --tags --force')
	})

	it('emits the created tag and passes it to the next workflow via client-payload', () => {
		const content = read_workflow(AUTO_TAG_PATH)

		expect(content).toContain('echo "tag=$TAG" >> $GITHUB_OUTPUT')
		expect(content).toContain('client-payload:')
		expect(content).toContain('steps.create_tag.outputs.tag')
	})
})

describe('production.yml — release merge source', () => {
	it('binds REF_NAME to the dispatched tag payload, not github.ref_name', () => {
		const content = read_workflow(PRODUCTION_PATH)

		expect(content).toContain('REF_NAME: ${{ github.event.client_payload.tag }}')
		expect(content).not.toContain('github.ref_name')
	})

	it('aborts the merge when the dispatch payload carries no tag', () => {
		expect(read_workflow(PRODUCTION_PATH)).toContain('if [ -z "$REF_NAME" ]')
	})
})

describe('templates/workflows/ci.yml — checkout credential hygiene', () => {
	it('sets persist-credentials: false on every checkout step', () => {
		const content = read_workflow(CI_TEMPLATE_PATH)
		const checkout_count = count_occurrences(content, 'actions/checkout@')
		const persist_count = count_occurrences(content, 'persist-credentials: false')

		expect(checkout_count).toBeGreaterThan(0)
		expect(persist_count).toBe(checkout_count)
	})
})
