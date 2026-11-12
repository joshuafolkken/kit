// joshuafolkken/kit#6503: the words `lane:value` fails with when its period holds no value to print —
// no sample for a metric, no numeric cell for a `cell` — shared with the drive, which reads that
// failure as a sample condition not yet met rather than an unreadable declaration. An address matching
// several numeric cells is no wait: more samples never narrow it, so the drive reads it as unreadable.

const MISSING = {
	SAMPLE: 'no sample',
	CELL: 'no numeric cell',
	SEVERAL: 'several numeric cells',
} as const

const UNSAMPLED: ReadonlyArray<string> = [MISSING.SAMPLE, MISSING.CELL]

// Whether a failed `lane:value` said its period has no value yet.
function is_unsampled(text: string): boolean {
	return UNSAMPLED.some((words) => text.includes(`: ${words} since `))
}

const lane_value_missing = { MISSING, is_unsampled }

export { lane_value_missing }
