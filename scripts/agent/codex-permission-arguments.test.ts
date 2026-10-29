import { describe, expect, it } from 'vitest'
import { codex_permission_arguments } from './codex-permission-arguments'

const DIGEST = /[a-f\d]{64}/gu
const ROOT_GRANT = [':root', 'read'] as const
const SPECIAL_PATH = '/fixture/path.with.dots 日本語 "quotes" \\ backslash'

describe('Codex permission profile inheritance', () => {
	it('selects one chain with each quoted path inside a TOML table', () => {
		const args = codex_permission_arguments.build([ROOT_GRANT, [SPECIAL_PATH, 'write']])

		expect(args.map((value) => value.replaceAll(DIGEST, 'digest'))).toStrictEqual([
			'-c',
			'default_permissions="josh_lane_digest_0"',
			'-c',
			'permissions.josh_lane_digest_0={filesystem={":root"="read"},extends="josh_lane_digest_1",network={enabled=true}}',
			'-c',
			'permissions.josh_lane_digest_1={filesystem={"/fixture/path.with.dots 日本語 \\"quotes\\" \\\\ backslash"="write"},network={enabled=true}}',
		])
	})

	it('keeps names stable for the same grants and separates different permission tables', () => {
		const first = codex_permission_arguments.build([ROOT_GRANT])
		const repeated = codex_permission_arguments.build([ROOT_GRANT])
		const changed = codex_permission_arguments.build([ROOT_GRANT, [SPECIAL_PATH, 'read']])

		expect(repeated).toStrictEqual(first)
		expect(changed[1]).not.toBe(first[1])
	})
})
