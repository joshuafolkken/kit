import { describe, expect, it } from 'vitest'
import { rework_classification } from './rework-classification'

// joshuafolkken/kit#8799: a non-defect body citing delivered work with no new goal is rework filed as
// an enhancement — before this check such a body was filed with no refusal at all.

const MERGED_PR = 7963
const OPEN_ISSUE = 8770
const EPIC = 8776
const DELIVERED: ReadonlySet<number> = new Set([MERGED_PR, EPIC])
const NONE: ReadonlySet<number> = new Set()
const NON_DEFECT = '- 種別: 非不具合'

function body_of(background: ReadonlyArray<string>, summary = '前の作業を手直しする。'): string {
	return [
		'## 概要',
		'',
		summary,
		'',
		'## 背景',
		'',
		...background,
		'',
		'## 現象',
		'',
		'x',
		'',
	].join('\n')
}

const REWORK = body_of([NON_DEFECT, '- 目的: 時間短縮', `- #${String(MERGED_PR)} が遅い`])

describe('rework_classification.problem — refusal', () => {
	it('refuses a non-defect body citing a merged pull request with no new goal', () => {
		const problem = rework_classification.problem(REWORK, DELIVERED)

		expect(problem).toContain(`#${String(MERGED_PR)}`)
		expect(problem).toContain('- 種別: 不具合')
		expect(problem).toContain('- 原因: #<PR>')
		expect(problem).toContain('- 新しい目標:')
	})

	it('refuses on a citation in the summary as well', () => {
		const body = body_of([NON_DEFECT], `#${String(MERGED_PR)} の品質が低い。`)

		expect(rework_classification.reworked(body, DELIVERED)).toStrictEqual([MERGED_PR])
	})

	it('reads an English body the same way', () => {
		const body = [
			'## Summary',
			'',
			`Rework #${String(MERGED_PR)}.`,
			'',
			'## Background',
			'',
			'- Type: non-defect',
		].join('\n')

		expect(rework_classification.reworked(body, DELIVERED)).toStrictEqual([MERGED_PR])
	})
})

describe('rework_classification.problem — passes', () => {
	it('passes a body with a new goal line', () => {
		const body = body_of([
			NON_DEFECT,
			'- 新しい目標: 2026-11-20 に立てた、1 分以内に終える目標',
			`- #${String(MERGED_PR)} を速くする`,
		])

		expect(rework_classification.problem(body, DELIVERED)).toBeUndefined()
	})

	it('passes a body citing only open Issues', () => {
		const body = body_of([NON_DEFECT, `- #${String(OPEN_ISSUE)} の後に入れる`])

		expect(rework_classification.problem(body, DELIVERED)).toBeUndefined()
	})

	it('passes a body citing delivered work only on its parent line', () => {
		const body = body_of([NON_DEFECT, `- parent: #${String(EPIC)}`])

		expect(rework_classification.problem(body, DELIVERED)).toBeUndefined()
	})

	it('does not count a citation inside a code fence', () => {
		const body = body_of([NON_DEFECT, '```', `#${String(MERGED_PR)}`, '```'])

		expect(rework_classification.problem(body, DELIVERED)).toBeUndefined()
	})

	it('leaves a defect body to the defect rules', () => {
		const body = body_of(['- 種別: 不具合', `- 原因: #${String(MERGED_PR)}`])

		expect(rework_classification.cited(body)).toStrictEqual([])
	})

	it('passes when nothing cited is delivered', () => {
		expect(rework_classification.problem(REWORK, NONE)).toBeUndefined()
	})
})

describe('rework_classification.references', () => {
	it('reads each same-repository number once, skipping cross-repository ones', () => {
		const body = body_of(
			[NON_DEFECT],
			`#${String(MERGED_PR)} と #${String(MERGED_PR)}、owner/repo#12 を見る。`,
		)

		expect(rework_classification.references(body)).toStrictEqual([MERGED_PR])
	})
})
