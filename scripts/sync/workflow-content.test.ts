import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sync } from './sync'

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

	it('verifies the tag exists and merges the explicit tag ref', () => {
		const content = read_workflow(PRODUCTION_PATH)

		expect(content).toContain('git rev-parse -q --verify "refs/tags/$REF_NAME"')
		expect(content).toContain('git merge "refs/tags/$REF_NAME"')
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

describe('templates/workflows/ci.yml — pull request E2E retry explanation', () => {
	it('keeps the crash-only explanation after syncing the workflow', () => {
		const template_path = fileURLToPath(new URL(CI_TEMPLATE_PATH, import.meta.url))
		const temporary_directory = mkdtempSync(path.join(tmpdir(), 'workflow-retry-comment-'))
		const workflow_destination = path.join(temporary_directory, '.github', 'workflows', 'ci.yml')

		try {
			sync.sync_file_mapping(template_path, workflow_destination)
			const synced_workflow = readFileSync(workflow_destination, 'utf8')

			expect(synced_workflow).toContain(
				'For a pull request, the retry chain starts only when the preview server crashed;',
			)
			expect(synced_workflow).toContain("steps.e2e_retry_check.outputs.crashed == 'true'")
			expect(synced_workflow).not.toContain('keeps a pull request out of the chain entirely')
		} finally {
			rmSync(temporary_directory, { recursive: true, force: true })
		}
	})
})
