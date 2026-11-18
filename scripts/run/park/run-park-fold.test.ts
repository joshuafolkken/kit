import { describe, expect, it } from 'vitest'
import { run_park_fold } from './run-park-fold'

// joshuafolkken/kit#7985: the Issue a fold option ships this one in, read from its permission line.
describe('run_park_fold.into_of', () => {
	it.each([
		['親（lane:fold 7945 --into #7951）', '7951'],
		['親（lane:fold 7945 --into 7951）', '7951'],
		['親（lane:fold 7945 --into  #7951 --reason x）', '7951'],
	])('reads %j as #%s', (permission, into) => {
		expect(run_park_fold.into_of(permission)).toBe(into)
	})

	it.each([
		['親（lane:fold 7945）'],
		['親（lane:fold 7945 --into #）'],
		['親（lane:fold 7945 --into #0）'],
	])('reads no Issue from %j', (permission) => {
		expect(run_park_fold.into_of(permission)).toBeUndefined()
	})

	it('reads no Issue from an option with no permission line', () => {
		expect(run_park_fold.into_of(undefined)).toBeUndefined()
	})
})
