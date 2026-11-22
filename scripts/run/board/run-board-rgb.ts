import type { Paint, TextColor } from './run-board-labels'

// joshuafolkken/kit#8674: a 24-bit color as three channels, scaled toward black or mixed toward another,
// drawn as a shade with its palette fallback, and the contrast of two colors as WCAG measures it — the
// ratio VS Code's terminal holds a foreground to (`minimumContrastRatio`, 4.5 by default) before it
// repaints it.

type Rgb = readonly [number, number, number]

const CHANNEL_MAX = 255
// WCAG 2's relative luminance: the sRGB curve's linear toe and its gamma, and each channel's weight.
const LINEAR_TOE = 0.03928
const LINEAR_SLOPE = 12.92
const GAMMA_OFFSET = 0.055
const GAMMA_SCALE = 1.055
const GAMMA = 2.4
const RED_WEIGHT = 0.2126
const GREEN_WEIGHT = 0.7152
const BLUE_WEIGHT = 0.0722
const WEIGHTS: Rgb = [RED_WEIGHT, GREEN_WEIGHT, BLUE_WEIGHT]
// The flare WCAG adds to both sides of the ratio.
const FLARE = 0.05

// A color written as a shade writes it, `R;G;B`.
function parsed(text: string): Rgb {
	const [red = 0, green = 0, blue = 0] = text.split(';').map(Number)

	return [red, green, blue]
}

// `rgb` with each channel at `share` of its value.
function scaled(rgb: Rgb, share: number): Rgb {
	const [red, green, blue] = rgb

	return [Math.round(red * share), Math.round(green * share), Math.round(blue * share)]
}

// `from` moved `share` of the way to `to`.
function mixed(from: Rgb, to: Rgb, share: number): Rgb {
	const [red = 0, green = 0, blue = 0] = from.map((channel, index) =>
		Math.round(channel + ((to[index] ?? channel) - channel) * share),
	)

	return [red, green, blue]
}

// `rgb` as a shade a 24-bit terminal draws, `named` on one drawing the palette only.
function shade_of(rgb: Rgb, named: TextColor): Paint {
	return { rgb: rgb.join(';'), named }
}

function linear(channel: number): number {
	const value = channel / CHANNEL_MAX

	if (value <= LINEAR_TOE) return value / LINEAR_SLOPE

	return ((value + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA
}

function luminance(rgb: Rgb): number {
	return rgb.reduce((sum, channel, index) => sum + linear(channel) * (WEIGHTS[index] ?? 0), 0)
}

// How much brighter the brighter of two colors is, 1 for the same color, 21 for white on black.
function contrast(first: Rgb, second: Rgb): number {
	const [darker = 0, brighter = 0] = [luminance(first), luminance(second)].toSorted(
		(left, right) => left - right,
	)

	return (brighter + FLARE) / (darker + FLARE)
}

const run_board_rgb = { contrast, mixed, parsed, scaled, shade_of }

export { run_board_rgb }
export type { Rgb }
