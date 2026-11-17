import { describe, expect, it } from 'vitest'
import { run_park_body } from './run-park-body'

const CLOSE = '親（issue:close）'
const FILE_AND_CLOSE = '親（issue:file … のあと issue:close）'
const PICK = '1 nothing to improve'

function option_lines(number: number, permission: string): ReadonlyArray<string> {
	return [
		`${String(number)}. Close it without implementing`,
		'   - 層: A',
		`   - 必要な権限: ${permission}`,
	]
}

function park_of(pick: string, ...permissions: ReadonlyArray<string>): string {
	const options = permissions.flatMap((permission, index) => option_lines(index + 1, permission))

	return ['## Close it?', '### 選択肢', ...options, '### 推奨', pick].join('\n')
}

// joshuafolkken/kit#7805: an option closing the Issue without implementing is written machine-readably.
describe('run_park_body closing options', () => {
	it('refuses a closing option not written as the parent permission (ac-fc98c480)', () => {
		expect(run_park_body.problem_of(park_of(PICK, 'なし（issue:close）'))).toContain(
			'option 1 names issue:close, which a child cannot run; write "- 必要な権限: 親（issue:close …）"',
		)
	})

	it.each([
		[CLOSE, true, false],
		[FILE_AND_CLOSE, true, true],
		['親', false, true],
		['なし', false, false],
	])(
		'reads %j as close_action %j and done_needed %j (ac-fc98c480)',
		(permission, is_close, is_done) => {
			const body = park_of(PICK, permission)

			expect(run_park_body.problem_of(body)).toBeUndefined()
			expect(run_park_body.close_action(body, 1)).toBe(is_close)
			expect(run_park_body.done_needed(body, 1)).toBe(is_done)
		},
	)

	it('prints the closing form in the schema it shows a parking child', () => {
		expect(run_park_body.FORMAT).toContain('必要な権限: 親（issue:close）')
	})

	it('is never taken by a parent with no person, recommended or not', () => {
		expect(run_park_body.auto_pick(park_of(PICK, CLOSE))).toBeUndefined()
		expect(run_park_body.default_pick(park_of('推奨なし both close', CLOSE))).toBeUndefined()
	})
})
