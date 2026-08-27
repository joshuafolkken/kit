import { describe, expect, it } from 'vitest'
import {
	AUTO_OK_LABEL,
	EPIC_LABEL,
	has_any_label,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
} from './issue-labels'

// The label names are the contract between these scripts and GitHub, and every one of them fails
// silently when it drifts: an epic filtered on the wrong name is never closed, and an issue matched
// on the wrong name is never excluded.

// Spelled out rather than compared to the constants themselves, which would assert nothing.
const EPIC_SPELLING = 'epic'
const IN_PROGRESS_SPELLING = 'in-progress'
const NEEDS_DECISION_SPELLING = 'needs-decision'
const AUTO_OK_SPELLING = 'auto-ok'
const NOT_DIRECTLY_RUNNABLE_COUNT = 3

describe('the label names', () => {
	it.each([
		[EPIC_LABEL, EPIC_SPELLING],
		[IN_PROGRESS_LABEL, IN_PROGRESS_SPELLING],
		[NEEDS_DECISION_LABEL, NEEDS_DECISION_SPELLING],
		[AUTO_OK_LABEL, AUTO_OK_SPELLING],
	])('%s is spelled exactly as GitHub holds it', (actual, expected) => {
		expect(actual).toBe(expected)
	})
})

describe('NOT_DIRECTLY_RUNNABLE_LABELS', () => {
	it.each([EPIC_LABEL, IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL])('holds %s', (label) => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(label)).toBe(true)
	})

	// Opting in is what makes an issue runnable outside an epic, so a set that also excluded it would
	// filter out every candidate the pickup exists to find.
	it('does not hold the opt-in label', () => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(AUTO_OK_LABEL)).toBe(false)
	})

	it('holds those three and nothing else', () => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.size).toBe(NOT_DIRECTLY_RUNNABLE_COUNT)
	})
})

describe('has_any_label', () => {
	it('matches a label present in the set', () => {
		expect(has_any_label([{ name: IN_PROGRESS_SPELLING }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(true)
	})

	// GitHub keeps the casing a label was created with and treats `Epic` and `epic` as one label, so
	// a repository that predates these scripts can answer with either spelling.
	it('matches regardless of the casing GitHub answers with', () => {
		expect(has_any_label([{ name: 'Epic' }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(true)
	})

	it('does not match an unrelated label', () => {
		expect(has_any_label([{ name: 'bug' }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})

	it('treats a missing labels field as no labels', () => {
		expect(has_any_label(undefined, NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})

	it('treats an empty labels field as no labels', () => {
		expect(has_any_label([], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})
})
