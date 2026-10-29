// Barra di avanzamento disegnata sul clock del surface: mentre `active` un riflesso scorre sulla
// parte piena; ferma, è una barra semplice. Ridisegna solo questa regione, non il pannello.
import type { ClientModule } from 'claude-code'

type Props = { pct: number; width: number; color: string; dim: string; shine: string; active: boolean }
type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 90
const RIFLESSO = 3

const Bar: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }

  const w = Math.max(1, props.width)
  const pieni = Math.max(0, Math.min(w, Math.round((props.pct / 100) * w)))
  // Il riflesso attraversa la parte piena e qualche cella oltre, così riparte con una pausa.
  const giro = pieni + 8
  const testa = ref.active && pieni > 0 ? ref.phase % giro : -1
  const pezzi: { text: string; color: string; bold?: boolean }[] = []
  const metti = (ch: string, color: string, bold?: boolean) => {
    const last = pezzi[pezzi.length - 1]
    if (last && last.color === color && last.bold === bold) last.text += ch
    else pezzi.push({ text: ch, color, bold })
  }
  for (let i = 0; i < w; i++) {
    if (i < pieni) {
      const lit = testa >= 0 && i <= testa && i > testa - RIFLESSO
      metti('━', lit ? props.shine : props.color, lit || undefined)
    } else if (i === pieni && ref.active) {
      metti(ref.phase % 6 < 3 ? '╸' : '─', ref.phase % 6 < 3 ? props.color : props.dim)
    } else {
      metti('─', props.dim)
    }
  }
  return (
    <Box width={w} overflow="hidden">
      <Box flexShrink={0}>
        {pezzi.map(p => (
          <Text color={p.color} bold={p.bold} mono>
            {p.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

export default Bar
