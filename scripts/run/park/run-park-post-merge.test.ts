import type { issue_read_cli } from '#scripts/issue/issue-read-cli'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_post_merge } from './run-park-post-merge'

type ReadBlock = typeof issue_read_cli.read_block

const { read_block_mock } = vi.hoisted(() => ({ read_block_mock: vi.fn<ReadBlock>() }))

vi.mock('#scripts/issue/issue-read-cli', () => ({
	issue_read_cli: { read_block: read_block_mock },
}))

const ISSUE = '8391'
const PLACE = 'the matrix TRACE screen'
const DECLARED_BODY = `## 背景\n\n- 種別: 不具合\n- マージ後の確認: ${PLACE}\n`
const PLAIN_BODY = '## 背景\n\n- 種別: 不具合\n'

function park_of(permission: string): string {
	return [
		'## 目視確認の待機',
		'',
		'### 選択肢',
		'1. A person looks at the screen',
		'   - 層: C',
		`   - 必要な権限: ${permission}`,
		'',
		'### 推奨',
		'1 only a person can look',
	].join('\n')
}

const VISUAL_PARK = park_of('人（目視確認）')
const ACCOUNT_PARK = park_of('人（外部アカウント）')

function trusted(body: string, is_body_trusted = true): Awaited<ReturnType<ReadBlock>> {
	return { kind: 'ok', block: '', body, trust: { is_body_trusted, has_trusted_comment: false } }
}

describe('run_park_post_merge.refusal_of', () => {
	it('refuses a visual-check park on an issue that declares a post-merge check', () => {
		const refusal = run_park_post_merge.refusal_of(DECLARED_BODY, VISUAL_PARK)

		expect(refusal).toContain(PLACE)
		expect(refusal).toContain('When there is no screenshot command')
		expect(refusal).toContain('look unchecked')
	})

	it('accepts a visual-check park on an issue without the declaration', () => {
		expect(run_park_post_merge.refusal_of(PLAIN_BODY, VISUAL_PARK)).toBeUndefined()
	})

	it('accepts a park for another reason on an issue that declares a post-merge check', () => {
		expect(run_park_post_merge.refusal_of(DECLARED_BODY, ACCOUNT_PARK)).toBeUndefined()
	})
})

describe('run_park_post_merge.is_refused', () => {
	beforeEach(() => {
		read_block_mock.mockReset().mockResolvedValue(trusted(DECLARED_BODY))
		vi.spyOn(console, 'error').mockImplementation(vi.fn<typeof console.error>())
	})

	it('refuses and prints the refusal for a trusted declaring body', async () => {
		await expect(run_park_post_merge.is_refused(ISSUE, VISUAL_PARK)).resolves.toBe(true)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(PLACE))
	})

	it('does not read the issue for a park that needs no visual check', async () => {
		await expect(run_park_post_merge.is_refused(ISSUE, ACCOUNT_PARK)).resolves.toBe(false)
		expect(read_block_mock).not.toHaveBeenCalled()
	})

	it('parks as before when the body is untrusted or the read fails', async () => {
		read_block_mock.mockResolvedValueOnce(trusted(DECLARED_BODY, false))
		read_block_mock.mockResolvedValueOnce({ kind: 'unreadable' })

		await expect(run_park_post_merge.is_refused(ISSUE, VISUAL_PARK)).resolves.toBe(false)
		await expect(run_park_post_merge.is_refused(ISSUE, VISUAL_PARK)).resolves.toBe(false)
	})
})
