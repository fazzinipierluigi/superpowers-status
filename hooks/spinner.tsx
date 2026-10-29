// Spinner braille sul clock del surface: gira finché `active`, altrimenti mostra `rest`.
import type { ClientModule } from 'claude-code'

type Props = { color: string; active: boolean; rest: string }
type Ref = { frame: number; active: boolean }
type State = { ref: Ref }

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const STEP_MS = 80

const Spinner: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { frame: 0, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.frame = (ref.frame + 1) % FRAMES.length
        surface.setState({ ref })
      }
    })
  }
  return (
    <Text color={props.color} mono>
      {props.active ? FRAMES[ref.frame] : props.rest}
    </Text>
  )
}

export default Spinner
