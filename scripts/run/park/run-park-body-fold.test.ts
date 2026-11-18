import { describe, expect, it } from 'vitest'
import { run_park_body } from './run-park-body'

const FOLD = '親（lane:fold 7945 --into #7951）'
const PICK = '1 the wiring lands with #7951'

function park_of(permission: string): string {
	return [
		'## Ship it with #7951?',
		'### 選択肢',
		'1. Ship it in #7951 pull request',
		'   - 層: A',
		`   - 必要な権限: ${permission}`,
		'### 推奨',
		PICK,
	].join('\n')
}

// joshuafolkken/kit#7985: an option shipping the Issue in another Issue's pull request is the parent's fold.
describe('run_park_body folding options', () => {
	it.each([['なし（lane:fold 7945 --into #7951）'], ['人（lane:fold 7945 --into #7951）']])(
		'refuses %j, a fold written as anything but the parent (ac-b526b319)',
		(permission) => {
			expect(run_park_body.problem_of(park_of(permission))).toContain(
				'option 1 names lane:fold, which a child cannot run; write "- 必要な権限: 親（lane:fold …）"',
			)
		},
	)

	it('accepts the parent fold, read as a fold needing no --done (ac-b526b319)', () => {
		const body = park_of(FOLD)

		expect(run_park_body.problem_of(body)).toBeUndefined()
		expect(run_park_body.fold_action(body, 1)).toBe(true)
		expect(run_park_body.fold_target(body, 1)).toBe('7951')
		expect(run_park_body.done_needed(body, 1)).toBe(false)
		expect(run_park_body.permission_of(body, 1)).toBe(FOLD)
	})

	it('reads no fold target from an option that is no fold', () => {
		const body = park_of('親（issue:close）')

		expect(run_park_body.fold_action(body, 1)).toBe(false)
		expect(run_park_body.fold_target(body, 1)).toBeUndefined()
	})

	it('prints the fold form in the schema it shows a parking child', () => {
		expect(run_park_body.FORMAT).toContain('必要な権限: 親（lane:fold <N> --into #<M>）')
	})
})
