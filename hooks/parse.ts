import type { Passo, Piano, TaskLibero, TaskPiano, Tempi, Todo } from '../types'

const MAX_TESTO = 70

const truncate = (t: string) => (t.length > MAX_TESTO ? t.slice(0, MAX_TESTO - 1) + '…' : t)

/** Percorso del piano dalla prima riga del registro: "# SDD ledger — plan: <percorso>". */
export function planFromLedger(registro: string): string | undefined {
  const prima = registro.split(/\r?\n/, 1)[0] ?? ''
  const m = prima.match(/plan:\s*(.+?)\s*$/)
  return m?.[1]
}

/**
 * Cartelle in cui cercare il registro: la cwd della sessione ("") e, se la sessione è in un
 * worktree, la root del repository principale, dove resta .superpowers (ignorato da git).
 */
export function ledgerBases(cwd: string, repo: string | undefined): string[] {
  const n = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return repo && n(repo) !== n(cwd) ? ['', n(repo)] : ['']
}

/** Un percorso relativo a una base ("" = cwd); un percorso assoluto resta com'è. */
export function resolveIn(base: string, percorso: string): string {
  if (!base || /^([\\/]|[A-Za-z]:[\\/])/.test(percorso)) return percorso
  return `${base}/${percorso}`
}

/** Task del piano ("### Task N: titolo") con i loro passi ("- [ ]" / "- [x]"). */
export function tasksFromPlan(piano: string): TaskPiano[] {
  const out: TaskPiano[] = []
  let cur: TaskPiano | undefined
  for (const riga of piano.split(/\r?\n/)) {
    const t = riga.match(/^###\s+Task\s+([\w.-]+):\s*(.*)$/)
    if (t) {
      cur = { id: t[1] ?? '', titolo: truncate((t[2] ?? '').trim()), fase: 'in coda', passi: [], agenti: [] }
      out.push(cur)
      continue
    }
    if (/^##\s/.test(riga)) { cur = undefined; continue }
    const p = riga.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/)
    if (cur && p) {
      const testo = (p[2] ?? '').replace(/\*\*Step\s*[\w.]*:?\*\*\s*/i, '').replace(/\*\*/g, '').replace(/`/g, '').trim()
      const passo: Passo = { testo: truncate(testo), fatto: p[1] !== ' ' }
      cur.passi.push(passo)
    }
  }
  return out
}

/** Fase di un task dall'ultima riga "Task N: …" del registro che la indica. */
export function phaseFromLine(testo: string): string | undefined {
  const t = testo.toLowerCase()
  if (/^complete\b|: complete\b|\bcomplete \(/.test(t) || t.startsWith('complete')) return 'completo'
  if (/pubblicat/.test(t)) return 'completo'
  if (/fix round|correzion/.test(t)) return 'correzioni'
  if (/review|revisione/.test(t)) return 'revisione'
  if (/^done|done_with_concerns/.test(t)) return 'consegnato'
  if (/dispatched|avviat/.test(t)) return 'in lavorazione'
  return undefined
}

/** Applica il registro ai task: fase, id dei subagenti, passi spuntati se completo. */
export function applyLedger(task: TaskPiano[], registro: string): TaskPiano[] {
  const perId = new Map(task.map(t => [t.id, { ...t, passi: t.passi.map(p => ({ ...p })), agenti: [...t.agenti] }]))
  for (const riga of registro.split(/\r?\n/)) {
    const m = riga.match(/^Task\s+([\w.-]+):\s*(.*)$/)
    if (!m) continue
    const id = m[1] ?? '', resto = m[2] ?? ''
    const t = perId.get(id)
    if (!t) continue
    const fase = phaseFromLine(resto)
    if (fase) t.fase = fase
    const ag = (resto.match(/\b(?:implementer id|agent id|id)\s+(a[0-9a-f]{8,})/i) ?? resto.match(/\b(a[0-9a-f]{16})\b/))?.[1]
    if (ag && !t.agenti.includes(ag)) t.agenti.push(ag)
  }
  const out = [...perId.values()]
  for (const t of out) if (t.fase === 'completo') t.passi = t.passi.map(p => ({ ...p, fatto: true }))
  return out
}

/** Percentuale di un task: passi spuntati; completo = 100. */
export function taskPercent(t: TaskPiano): number {
  if (t.fase === 'completo') return 100
  if (t.passi.length === 0) return 0
  return Math.round((t.passi.filter(p => p.fatto).length / t.passi.length) * 100)
}

/** Percentuale di un piano: task completi più la quota dei passi dei task in corso. */
export function planPercent(task: TaskPiano[]): number {
  if (task.length === 0) return 0
  const somma = task.reduce((s, t) => s + taskPercent(t), 0)
  return Math.round(somma / task.length)
}

const FASI_ATTIVE = new Set(['in lavorazione', 'revisione', 'correzioni', 'consegnato'])
export const isActivePhase = (f: string) => FASI_ATTIVE.has(f)

/** Minuti per passo quando non c'è ancora nessun task misurato. */
export const MS_PASSO_INIZIALE = 2 * 60 * 1000

const stepCount = (n: number) => Math.max(1, n)

/**
 * Durata di un passo: mediana di durata/passi dei task misurati, in ogni piano conosciuto.
 * `misurati` è quanti task la sostengono: 0 vuol dire stima iniziale.
 */
export function stepPace(tempi: Tempi): { msPasso: number; misurati: number } {
  const r: number[] = []
  for (const piano of Object.values(tempi))
    for (const t of Object.values(piano))
      if (t.fine !== undefined && t.fine > t.inizio) r.push((t.fine - t.inizio) / stepCount(t.passi))
  if (r.length === 0) return { msPasso: MS_PASSO_INIZIALE, misurati: 0 }
  r.sort((a, b) => a - b)
  const m = Math.floor(r.length / 2)
  const med = r.length % 2 ? (r[m] ?? 0) : ((r[m - 1] ?? 0) + (r[m] ?? 0)) / 2
  return { msPasso: med, misurati: r.length }
}

/** Chiave del task nei tempi. */
export const timingKey = (t: TaskPiano) => t.chiave ?? t.id

/** Durata prevista di un task. */
export const estimateTask = (t: TaskPiano, msPasso: number) => stepCount(t.passi.length) * msPasso

/** Durata misurata di un task finito, se la mod l'ha visto iniziare e finire. */
export function measuredDuration(tempi: Tempi, piano: string, id: string): number | undefined {
  const t = tempi[piano]?.[id]
  return t?.fine !== undefined ? t.fine - t.inizio : undefined
}

/** Fine prevista di un task attivo (istante), dall'inizio misurato più la stima. */
export function taskEnd(tempi: Tempi, piano: string, t: TaskPiano, msPasso: number, adesso: number): number {
  const inizio = tempi[piano]?.[timingKey(t)]?.inizio ?? adesso
  return inizio + estimateTask(t, msPasso)
}

/**
 * Fine prevista del piano: i task vanno uno dopo l'altro, quindi si somma il residuo dei task
 * attivi (zero se già oltre la stima) e la stima di quelli in coda.
 */
export function planEnd(tempi: Tempi, p: Piano, msPasso: number, adesso: number): number | undefined {
  let resto = 0
  let aperti = 0
  for (const t of p.task) {
    if (t.fase === 'completo') continue
    aperti++
    resto += isActivePhase(t.fase) ? Math.max(0, taskEnd(tempi, p.nome, t, msPasso, adesso) - adesso) : estimateTask(t, msPasso)
  }
  return aperti === 0 ? undefined : adesso + resto
}

/**
 * Aggiorna i tempi con le fasi lette ora: inizio quando un task diventa attivo, fine quando
 * diventa completo. Un task trovato già completo non ha misura. Restituisce undefined se nulla cambia.
 */
export function updateTimings(tempi: Tempi, piani: Piano[], adesso: number): Tempi | undefined {
  let cambiato = false
  const out: Tempi = { ...tempi }
  for (const p of piani) {
    const piano = { ...(out[p.nome] ?? {}) }
    for (const t of p.task) {
      const k = timingKey(t)
      const rec = piano[k]
      if (isActivePhase(t.fase) && !rec) {
        piano[k] = { inizio: adesso, passi: t.passi.length }
        cambiato = true
      } else if (rec && t.fase === 'completo' && rec.fine === undefined) {
        piano[k] = { ...rec, fine: adesso, passi: t.passi.length }
        cambiato = true
      } else if (rec && rec.passi !== t.passi.length) {
        piano[k] = { ...rec, passi: t.passi.length }
        cambiato = true
      }
    }
    out[p.nome] = piano
  }
  return cambiato ? out : undefined
}

/** Tiene solo i piani più recenti nello storico, per non far crescere lo store senza limite. */
export function pruneTimings(tempi: Tempi, max: number): Tempi {
  const lastTime = (p: Record<string, { inizio: number; fine?: number }>) =>
    Math.max(0, ...Object.values(p).map(t => t.fine ?? t.inizio))
  const nomi = Object.keys(tempi).sort((a, b) => lastTime(tempi[b] ?? {}) - lastTime(tempi[a] ?? {}))
  return Object.fromEntries(nomi.slice(0, max).map(n => [n, tempi[n] ?? {}]))
}

// ---------------------------------------------------------------- lavoro fuori da superpowers

const FASE_DA_STATO: Record<string, string> = { pending: 'in coda', in_progress: 'in lavorazione', completed: 'completo' }

const cleanText = (t: string) => t.replace(/\*\*/g, '').replace(/`/g, '').trim()

/** Checkbox markdown di un testo, come passi. */
export function stepsFrom(testo: string): Passo[] {
  const out: Passo[] = []
  for (const riga of testo.split(/\r?\n/)) {
    const p = riga.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    if (p) out.push({ testo: truncate(cleanText(p[2] ?? '')), fatto: p[1] !== ' ' })
  }
  return out
}

/**
 * Fase dai passi spuntati: tutti = completo, alcuni = in lavorazione, nessuno = in coda.
 * Si lavora in ordine: se nessuno è in corso, il primo non finito dopo uno finito è quello attivo.
 */
function phasesFromSteps(task: TaskPiano[]): TaskPiano[] {
  return markFirstActive(task.map(t => {
    const fatti = t.passi.filter(p => p.fatto).length
    const fase = t.passi.length > 0 && fatti === t.passi.length ? 'completo' : fatti > 0 ? 'in lavorazione' : 'in coda'
    return { ...t, fase }
  }))
}

function markFirstActive(out: TaskPiano[]): TaskPiano[] {
  if (!out.some(t => isActivePhase(t.fase)) && out.some(t => t.fase === 'completo')) {
    const primo = out.find(t => t.fase === 'in coda')
    if (primo) primo.fase = 'in lavorazione'
  }
  return out
}

/**
 * Task da un markdown qualsiasi: "### Task N:" come superpowers se ci sono; altrimenti ogni
 * titolo ##–#### con checkbox sotto; altrimenti ogni checkbox è un task a sé.
 */
export function tasksFromMarkdown(testo: string): TaskPiano[] {
  const sp = tasksFromPlan(testo)
  if (sp.length) return phasesFromSteps(sp)
  const out: TaskPiano[] = []
  let cur: TaskPiano | undefined
  for (const riga of testo.split(/\r?\n/)) {
    const h = riga.match(/^#{2,4}\s+(.*)$/)
    if (h) {
      cur = { id: '', titolo: truncate(cleanText(h[1] ?? '')), fase: 'in coda', passi: [], agenti: [] }
      out.push(cur)
      continue
    }
    const p = stepsFrom(riga)[0]
    if (p && cur) cur.passi.push(p)
  }
  const conPassi = out.filter(t => t.passi.length > 0).map((t, i) => ({ ...t, id: String(i + 1) }))
  if (conPassi.length) return phasesFromSteps(conPassi)
  return markFirstActive(stepsFrom(testo).map((p, i) => ({
    id: String(i + 1), titolo: p.testo, fase: p.fatto ? 'completo' : 'in coda', passi: [], agenti: [],
  })))
}

/** Titolo di un markdown: il primo "# ", altrimenti il nome del file. */
export function markdownTitle(testo: string, percorso: string): string {
  const h1 = testo.match(/^#\s+(.+)$/m)?.[1]
  return truncate(cleanText(h1 ?? percorso.split(/[\\/]/).pop() ?? percorso))
}

/** La lista task di Claude Code come piano: ogni task coi passi presi dalle checkbox della descrizione. */
export function planFromTasks(lista: TaskLibero[], sessione: string): Piano | undefined {
  if (lista.length === 0) return undefined
  const task = lista.map(t => ({
    id: t.id, titolo: truncate(t.titolo), fase: FASE_DA_STATO[t.stato] ?? 'in coda', passi: stepsFrom(t.descrizione), agenti: [],
  }))
  return { nome: `task:${sessione}`, titolo: 'Task della sessione', fonte: 'task', task }
}

/** I to-do (TodoWrite) come piano; la chiave dei tempi è il testo, perché la lista viene riscritta. */
export function planFromTodos(lista: Todo[], sessione: string): Piano | undefined {
  if (lista.length === 0) return undefined
  const task = lista.map((t, i) => ({
    id: String(i + 1), titolo: truncate(t.testo), fase: FASE_DA_STATO[t.stato] ?? 'in coda', passi: [], agenti: [], chiave: t.testo,
  }))
  return { nome: `todo:${sessione}`, titolo: 'To-do della sessione', fonte: 'todo', task }
}

/** Un testo markdown merita di essere seguito se ha almeno due checkbox. */
export const hasCheckboxes = (testo: string) => (testo.match(/^\s*[-*]\s+\[( |x|X)\]\s+/gm) ?? []).length >= 2
