// Conto alla rovescia verso `endAt`, sul clock del surface: il pannello non deve ridisegnarsi ogni secondo.
// `now` arriva dal modulo degli hook; tra un ridisegno e l'altro conta da solo. Oltre la stima diventa `+m:ss`.
import type { ClientModule } from 'claude-code'

type Props = { endAt: number; now: number; color: string; warn: string; suffix: string }
type Ref = { base: number; ticks: number; lastNow: number }
type State = { ref: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

const Eta: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: -1 }
  if (props.now !== ref.lastNow) {
    // Nuova lettura dal modulo degli hook: si riparte da lì.
    ref.lastNow = props.now
    ref.base = props.endAt - props.now
    ref.ticks = 0
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      ref.ticks += 1
      surface.setState({ ref })
    })
  }
  const resto = ref.base - ref.ticks * 1000
  return resto >= 0 ? (
    <Text color={props.color}>
      ⏱ {fmt(resto)}
      {props.suffix}
    </Text>
  ) : (
    <Text color={props.warn}>⏱ +{fmt(-resto)} oltre stima</Text>
  )
}

export default Eta
