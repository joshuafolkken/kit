// joshuafolkken/kit#6503: the words `lane:value` fails with when its period holds no value to print —
// no sample for a metric, no single numeric cell for a `cell` — shared with the drive, which reads that
// failure as a sample condition not yet met rather than an unreadable declaration.

const MISSING = {
	SAMPLE: 'no sample',
	CELL: 'no single numeric cell',
} as const

// Whether a failed `lane:value` said its period has no value yet.
function is_unsampled(text: string): boolean {
	return Object.values(MISSING).some((words) => text.includes(`: ${words} since `))
}

const lane_value_missing = { MISSING, is_unsampled }

export { lane_value_missing }
