import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import { describe, expect, it } from 'vitest'
import { test_related_whole } from './test-related-whole'

const LANE = path.join(path.sep, 'work', '.kit-lanes', '7014')
const MAIN = path.join(path.sep, 'work', 'kit')
const DEFAULT_ROOT = {}
const FLAG = [gate_labels.KEEP_WHOLE_SUITE_FLAG]

// joshuafolkken/kit#7014: a lane's gate leaves the whole suite to CI's required `Checks`.
describe('test_related_whole.is_whole_suite_kept', () => {
	it('keeps the whole suite for the gate in a main checkout', () => {
		expect(test_related_whole.is_whole_suite_kept(FLAG, MAIN, DEFAULT_ROOT)).toBe(true)
	})

	it('drops the whole suite for the gate in a lane', () => {
		expect(test_related_whole.is_whole_suite_kept(FLAG, LANE, DEFAULT_ROOT)).toBe(false)
	})

	it('drops it in a lane under a configured lane root', () => {
		const root = path.join(path.sep, 'lanes', '7014')

		expect(
			test_related_whole.is_whole_suite_kept(FLAG, root, { JOSH_LANE_ROOT: path.dirname(root) }),
		).toBe(false)
	})

	it('never keeps it without the flag', () => {
		expect(test_related_whole.is_whole_suite_kept([], MAIN, DEFAULT_ROOT)).toBe(false)
	})
})
