import { run_board_theme_tones, type Tone } from './run-board-theme-tones'

// joshuafolkken/kit#7988: the one table of what each icon reads as; the render modules keep their own
// icons and never see it. joshuafolkken/kit#8150: each text in the color of the tone of the state its
// icon marks. joshuafolkken/kit#8505: each row holds the icon's letters (capitals, so a board in no
// theme draws them as one in a theme does) and, for one read faster as a shape (`>>` running, `||`
// paused, `<-` waiting on an Issue), that shape of the same width; both share the row's tone. `⏸` takes
// the one-column rule `║`.

type Glyph = readonly [letters: string, tone: Tone, shape?: string]
type Glyphs = ReadonlyMap<string, Glyph>

// Each emoji the board's sources draw, by what it marks, one `emoji,letters,tone[,shape]` row a line —
// one string rather than a literal per row, so the table is not read as rows of duplicated code. A
// text-presentation symbol one column wide gets one character. A section heading's icon reads as its
// rule, so every heading reads `V -- NAME` as one whose icon is dropped beside its label does
// (joshuafolkken/kit#8154).
const EMOJI_ROWS = String.raw`
💻,--,info
📈,--,info
⛽,--,info
🧵,--,info
📌,--,info
🏠,--,info
⌛,--,info
🪢,--,info
🚨,P1,alert
🔺,P2,caution
✨,FT,info,**
🐛,BG,info
🔍,IV,running
📝,PL,running
🔨,BD,running
👀,RV,running
🔀,MG,done
📦,CM,running
🔂,R2,running
🚢,SH,done
📣,RP,running
💥,FL,alert
⏳,HD,idle,..
💤,ZZ,idle
✅,OK,done
🚫,XX,alert
🔄,RN,running,>>
🏁,FN,done,|>
⏩,AD,idle,>|
🧊,PS,idle,||
❔,??,caution
❓,Q?,human
❗,!!,alert
🔧,> ,info
💬,: ,info
🔭,WT,idle,OO
🔚,EN,info,-|
⏰,T+,caution
🕘,AG,idle
🎯,ET,info,->
💓,HB,info,<3
🧠,MM,info
💾,DK,info
💪,CP,info
⚡,PW,info
🔥,HT,alert
📴,OF,idle
🔊,SN,info,<)
🔇,MU,idle,<X
✋,HU,human,!?
🙋,DC,human,\O
🛑,ST,alert,[]
🧳,ER,info
🔗,LK,idle,<-
📂,FD,info,//
🧍,SO,info
🙅,NO,alert
📋,OR,info,1.
🚦,SG,info
🛫,TO,info
📮,IS,info
📅,NB,idle,>=
⚓,AN,info
🔁,RT,caution,<<
🆕,NW,info
🕒,NW,info,()
🧨,XP,alert
🚪,DR,info
📥,IN,info,\/
📤,DS,info,/\
🚀,T0,done,^^
🤝,HO,info,><
🤔,JG,caution
💭,SS,info
🚧,BL,alert,##
🔒,LC,caution
🪫,LO,caution,[_
📰,NS,info
🔏,HM,info
🔑,AU,info,O-
🐰,CR,info
⛔,RL,alert
🤏,CX,info
💺,SE,info,__
🌐,WB,info
👻,GH,info
🧭,SV,info
🎬,PA,info
🤖,AI,info
🙏,TY,info
🟢,AC,done
📁,EP,info,[+
▶,>,info
◀,<,info
▪,*,info
⏸,=,idle,║
⏭,>,info
⏱,T,info
↪,^,info
🅿,P,info
☑,V,done
⛓,#,info
🗓,D,info
⚠,!,caution
🛤,=,info
🗜,C,info
🖥,M,info
🎛,K,info
🏔,^,info
`

// The one-column symbols drawn as one ASCII character. The rules and gauges (`■ █ ▁…▇ ┊ ├ └`) stay.
const SYMBOL_ROWS = `
→,>,info
↻,@,info
▸,>,info
▾,V,info
✚,+,done
✓,+,done
✗,X,alert
`

const FIELD = ','

function tone_of(name: string): Tone {
	const tone = run_board_theme_tones.TONES.find((candidate) => candidate === name)

	if (tone === undefined) throw new Error(`Glyph table names no tone "${name}"`)

	return tone
}

function entry_of(row: string): [string, Glyph] {
	const [icon = '', letters = '', tone = '', shape] = row.split(FIELD)
	const toned = tone_of(tone)

	return [icon, shape === undefined ? [letters, toned] : [letters, toned, shape]]
}

function glyphs_of(rows: string): Glyphs {
	return new Map(
		rows
			.trim()
			.split('\n')
			.map((row) => entry_of(row)),
	)
}

const run_board_theme_glyph_table = {
	EMOJI: glyphs_of(EMOJI_ROWS),
	SYMBOLS: glyphs_of(SYMBOL_ROWS),
	glyphs_of,
}

export { run_board_theme_glyph_table }
export type { Glyph, Glyphs }
