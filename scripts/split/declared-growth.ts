import type { SizeRatios } from '#scripts/lane/lane-size-stats'

// Missing axes use the historical correction; measured zero growth remains zero.
const FALLBACK = 2

function factor(ratios: SizeRatios | undefined, axis: 'files' | 'lines'): number {
	return ratios?.[axis] ?? FALLBACK
}

function axis_text(ratios: SizeRatios | undefined, axis: 'files' | 'lines'): string {
	const source = ratios?.[axis] === undefined ? 'fallback' : 'measured'

	return `${axis} × ${String(factor(ratios, axis))} (${source})`
}

function text(ratios?: SizeRatios): string {
	return `growth ${axis_text(ratios, 'files')} / ${axis_text(ratios, 'lines')}`
}

const declared_growth = { FALLBACK, factor, text }

export { declared_growth }
