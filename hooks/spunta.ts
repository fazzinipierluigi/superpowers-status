// Modifica di un piano markdown: spunta, rinomina e aggiunge passi; riassunto dello stato.
// Logica pura (testo in, testo out), usata dal tool `update_plan`.

/** Un'operazione sul piano. */
export type Operation = {
  /** Il task: numero ("3"), "Task 3" o parte del titolo. Assente: tutto il piano. */
  task?: string
  /** Il passo: numero (1 = primo del task) o parte del testo. Assente: tutti i passi del task. */
  step?: string | number
  /** Stato da dare al passo: true spuntato (predefinito), false da fare. */
  done?: boolean
  /** Nuovo testo del passo indicato. */
  text?: string
  /** Aggiunge un passo nuovo in fondo al task (o dopo `step`, se indicato), da fare. */
  add?: string
}

type Sezione = { id: string; titolo: string; inizio: number; passi: number[] }

const CHECKBOX = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$/
const TASK = /^###\s+Task\s+([\w.-]+):\s*(.*)$/
const TITOLO = /^#{2,4}\s+(.*)$/
const RECINTO = /^\s*(```|~~~)/

const cleanText = (t: string) => t.replace(/\*\*Step\s*[\w.]*:?\*\*\s*/i, '').replace(/\*\*/g, '').replace(/`/g, '').trim()
const flatten = (t: string) => cleanText(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

/** Righe dentro un blocco di codice recintato: lì le checkbox non sono passi. */
function codeLines(righe: string[]): boolean[] {
  let dentro = false
  return righe.map(r => {
    if (RECINTO.test(r)) { dentro = !dentro; return true }
    return dentro
  })
}

/**
 * Sezioni del piano, come le legge il pannello: "### Task N:" se ci sono; altrimenti i titoli
 * ##–#### con checkbox sotto (numerati da 1); altrimenti una sola sezione con tutte le checkbox.
 */
function sections(righe: string[]): Sezione[] {
  const codice = codeLines(righe)
  const isStep = (i: number) => !codice[i] && CHECKBOX.test(righe[i] ?? '')
  if (righe.some((r, i) => !codice[i] && TASK.test(r))) {
    const out: Sezione[] = []
    let cur: Sezione | undefined
    righe.forEach((r, i) => {
      if (codice[i]) return
      const t = r.match(TASK)
      if (t) { cur = { id: t[1] ?? '', titolo: cleanText(t[2] ?? ''), inizio: i, passi: [] }; out.push(cur); return }
      if (/^##\s/.test(r)) { cur = undefined; return }
      if (cur && isStep(i)) cur.passi.push(i)
    })
    return out
  }
  const out: Sezione[] = []
  let cur: Sezione | undefined
  righe.forEach((r, i) => {
    if (codice[i]) return
    const h = r.match(TITOLO)
    if (h) { cur = { id: '', titolo: cleanText(h[1] ?? ''), inizio: i, passi: [] }; out.push(cur); return }
    if (cur && isStep(i)) cur.passi.push(i)
  })
  const conPassi = out.filter(s => s.passi.length > 0).map((s, n) => ({ ...s, id: String(n + 1) }))
  if (conPassi.length) return conPassi
  const tutti = righe.map((_, i) => i).filter(isStep)
  return tutti.length ? [{ id: '', titolo: '', inizio: -1, passi: tutti }] : []
}

function findTask(sez: Sezione[], chiave: string): Sezione | string {
  const k = chiave.trim().replace(/^task\s+/i, '').replace(/:$/, '')
  const perId = sez.find(s => s.id && s.id.toLowerCase() === k.toLowerCase())
  if (perId) return perId
  const q = flatten(k)
  const perTitolo = sez.filter(s => s.titolo && flatten(s.titolo).includes(q))
  if (perTitolo.length === 1) return perTitolo[0] as Sezione
  if (perTitolo.length > 1) return `task "${chiave}" is ambiguous: ${perTitolo.map(s => `Task ${s.id}`).join(', ')}`
  return `task "${chiave}" not found (tasks: ${sez.map(s => s.id).filter(Boolean).join(', ') || 'none'})`
}

function findSteps(righe: string[], passi: number[], chiave: string | number, dove: string): number[] | string {
  const n = typeof chiave === 'number' ? chiave : /^\s*\d+\s*$/.test(chiave) ? Number(chiave) : undefined
  if (n !== undefined) {
    const r = passi[n - 1]
    return r !== undefined ? [r] : `step ${n} does not exist in ${dove} (it has ${passi.length} steps)`
  }
  const q = flatten(String(chiave))
  const trovati = passi.filter(i => flatten(righe[i]?.match(CHECKBOX)?.[4] ?? '').includes(q))
  if (trovati.length === 0) return `no step contains "${chiave}" in ${dove}`
  // Più passi con lo stesso testo: il primo ancora da cambiare.
  return trovati.slice(0, 1)
}

const stepText = (riga: string) => cleanText(riga.match(CHECKBOX)?.[4] ?? riga)
const sectionLabel = (s: Sezione) => (s.id ? `Task ${s.id}` : s.titolo || 'plan')

/** Applica le operazioni al testo del piano, in ordine. */
export function applyOperations(md: string, ops: Operation[]): { testo: string; fatte: string[]; errori: string[] } {
  const a_capo = md.includes('\r\n') ? '\r\n' : '\n'
  const righe = md.split(/\r?\n/)
  const fatte: string[] = []
  const errori: string[] = []
  for (const op of ops) {
    const sez = sections(righe)
    if (sez.length === 0) { errori.push('the file has no `- [ ]` checkboxes'); break }
    let s: Sezione
    if (op.task !== undefined && String(op.task).trim()) {
      const t = findTask(sez, String(op.task))
      if (typeof t === 'string') { errori.push(t); continue }
      s = t
    } else {
      s = { id: '', titolo: 'plan', inizio: -1, passi: sez.flatMap(x => x.passi) }
    }
    const dove = sectionLabel(s)

    if (op.add !== undefined) {
      const testo = op.add.trim()
      if (!testo) { errori.push('`add` is empty'); continue }
      let dopo: number
      if (op.step !== undefined) {
        const p = findSteps(righe, s.passi, op.step, dove)
        if (typeof p === 'string') { errori.push(p); continue }
        dopo = p[0] as number
      } else {
        dopo = s.passi.length ? (s.passi[s.passi.length - 1] as number) : s.inizio
      }
      if (dopo < 0) { errori.push(`cannot tell where to add in ${dove}`); continue }
      const rientro = s.passi.length ? (righe[s.passi[0] as number]?.match(/^(\s*[-*]\s+)/)?.[1] ?? '- ') : '- '
      righe.splice(dopo + 1, 0, `${rientro}[ ] ${testo}`)
      fatte.push(`${dove}: added "${testo}"`)
      continue
    }

    let bersagli: number[]
    if (op.step !== undefined) {
      const p = findSteps(righe, s.passi, op.step, dove)
      if (typeof p === 'string') { errori.push(p); continue }
      bersagli = p
    } else if (op.task !== undefined) {
      bersagli = s.passi
    } else {
      errori.push('give `task` and/or `step`'); continue
    }
    if (bersagli.length === 0) { errori.push(`${dove} has no steps`); continue }

    if (op.text !== undefined) {
      const nuovo = op.text.trim()
      for (const i of bersagli) {
        righe[i] = (righe[i] ?? '').replace(CHECKBOX, (_m, a: string, x: string, b: string) => `${a}${x}${b}${nuovo}`)
      }
      fatte.push(`${dove}: step renamed to "${nuovo}"`)
    }
    if (op.text === undefined || op.done !== undefined) {
      const segno = op.done === false ? ' ' : 'x'
      let n = 0
      for (const i of bersagli) {
        const r = righe[i] ?? ''
        const m = r.match(CHECKBOX)
        if (!m) continue
        if ((m[2] === ' ') !== (segno === ' ')) n++
        righe[i] = r.replace(CHECKBOX, (_m, a: string, _x: string, b: string, t: string) => `${a}${segno}${b}${t}`)
      }
      const cosa = bersagli.length === 1 ? `"${stepText(righe[bersagli[0] as number] ?? '')}"` : `${bersagli.length} steps`
      fatte.push(`${dove}: ${cosa} ${segno === 'x' ? 'ticked' : 'to do'}${n === 0 ? ' (already was)' : ''}`)
    }
  }
  return { testo: righe.join(a_capo), fatte, errori }
}

/** Riassunto del piano per il modello: task con i passi numerati e il prossimo passo da fare. */
export function planStatus(md: string, maxRighe = 80): string {
  const righe = md.split(/\r?\n/)
  const sez = sections(righe)
  if (sez.length === 0) return 'The file has no `- [ ]` checkboxes.'
  const out: string[] = []
  let prossimo: string | undefined
  let fatti = 0, totale = 0
  for (const s of sez) {
    const stati = s.passi.map(i => (righe[i]?.match(CHECKBOX)?.[2] ?? ' ') !== ' ')
    const f = stati.filter(Boolean).length
    fatti += f; totale += stati.length
    out.push(`${sectionLabel(s)}${s.id && s.titolo ? `: ${s.titolo}` : ''} — ${f}/${stati.length}${f === stati.length ? ' ✓' : ''}`)
    // I passi si elencano solo per i task non finiti.
    if (f < stati.length) {
      s.passi.forEach((i, n) => {
        out.push(`  ${n + 1}. [${stati[n] ? 'x' : ' '}] ${stepText(righe[i] ?? '')}`)
        if (!stati[n] && !prossimo) prossimo = `${sectionLabel(s)}, step ${n + 1}: ${stepText(righe[i] ?? '')}`
      })
    }
  }
  const corpo = out.length > maxRighe ? [...out.slice(0, maxRighe), `… (${out.length - maxRighe} lines omitted)`] : out
  return [`Progress: ${fatti}/${totale} steps.`, prossimo ? `Next: ${prossimo}` : 'All steps are ticked.', '', ...corpo].join('\n')
}
