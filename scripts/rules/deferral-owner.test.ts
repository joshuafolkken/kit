import { describe, expect, it } from 'vitest'
import { deferral_owner } from './deferral-owner'

const OWNER = 'joshuafolkken'

// The two deferrals of the epic #8276 filing report, which left both points owned by nobody.
const MEASURE_LATER = '目標の線は、改善後の実測を見てから決めるのが良いです。'
const FILE_LATER = '出荷 1 回目の sync は、原因が見えたら、その時に起票すれば足りる。'

describe('deferral_owner.needs_owner', () => {
	it.each([
		['a wait-for-the-measurement deferral', MEASURE_LATER],
		['a file-it-then deferral', FILE_LATER],
		['an English decide-later deferral', 'We can decide later once the numbers are in.'],
		['an English file-it-when deferral', 'File it when the cause is known.'],
	])('fires on %s with no owner', (_name, message) => {
		expect(deferral_owner.needs_owner(message, OWNER)).toBe(true)
	})

	it('fires when the owner sits in another paragraph', () => {
		const message = `${MEASURE_LATER}\n\n別件: #8300 は完了。`

		expect(deferral_owner.needs_owner(message, OWNER)).toBe(true)
	})
})

describe('deferral_owner.needs_owner — silent', () => {
	it.each([
		['an Issue number', `${MEASURE_LATER}\n担う Issue: #8300`],
		['an Issue URL', `${FILE_LATER} https://github.com/joshuafolkken/kit/issues/8301`],
		['a filing draft', `${FILE_LATER}\n起票案: "Find the cause of the first ship sync"`],
		['a reason not to track', `${MEASURE_LATER}\n一度きりの判断なので追わない。`],
		['an English reason', 'Decide later; not worth tracking since it is a one-off.'],
	])('is silent when the paragraph carries %s', (_name, message) => {
		expect(deferral_owner.needs_owner(message, OWNER)).toBe(false)
	})

	it.each([
		['a fenced block', `\`\`\`\n${MEASURE_LATER}\n\`\`\``],
		['a quote line', `> ${FILE_LATER}`],
	])('is silent on a deferral inside %s', (_name, message) => {
		expect(deferral_owner.needs_owner(message, OWNER)).toBe(false)
	})

	it('is silent when the reply names a third-party repository', () => {
		const message = `https://github.com/sveltejs/kit について、${FILE_LATER}`

		expect(deferral_owner.needs_owner(message, OWNER)).toBe(false)
	})

	it('is silent when the session owner cannot be read', () => {
		expect(deferral_owner.needs_owner(FILE_LATER, undefined)).toBe(false)
	})

	it('is silent on a reply that defers nothing', () => {
		expect(deferral_owner.needs_owner('実装を終え、ゲートは緑です。', OWNER)).toBe(false)
	})
})
