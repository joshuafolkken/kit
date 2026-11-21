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

// joshuafolkken/kit#7818: the #7780 parks named the parent's close and filing in free text, so each
// adopt requeued the lane into the same dead end.
describe('run_park_body free-text parent actions', () => {
	const PICK_TWO = '2 file the follow-up'
	const CLOSE_AND_FILE = 'Issue のクローズと起票'

	it.each([
		['the 13:50:58 park', PICK_TWO, ['Issue のクローズ', 'Issue の起票']],
		['the 13:55:07 park', PICK, [CLOSE_AND_FILE]],
	])('refuses %s, showing the close and filing forms (ac-f4dcd316)', (_case, pick, permissions) => {
		const problem = run_park_body.problem_of(park_of(pick, ...permissions))

		expect(problem).toContain(`option 1 names "${permissions[0] ?? ''}" as its permission`)
		expect(problem).toContain(`"${CLOSE}"`)
		expect(problem).toContain('"親（issue:file …）"')
	})

	it('still summarizes such a park already written, so the board shows the stop', () => {
		expect(run_park_body.summary_of(park_of(PICK, CLOSE_AND_FILE))).toBe('推奨: 1（層 A）')
	})

	it('accepts the park rewritten with the parent close, adopted as a close (ac-f4dcd316)', () => {
		const body = park_of(PICK, CLOSE, '親（issue:file --route interrupt --blocks-finder）')

		expect(run_park_body.problem_of(body)).toBeUndefined()
		expect(run_park_body.close_action(body, 1)).toBe(true)
	})
})
