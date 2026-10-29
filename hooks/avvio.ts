// Avvio di un nuovo piano di lavoro dal pannello: scelta del flusso e testo del prompt.

export type Via = 'superpowers' | 'interno'

/** Skill superpowers che servono al flusso completo: scrittura del piano ed esecuzione. */
export function superpowersDisponibile(comandi: string[]): boolean {
  const ha = (n: string) => comandi.some(c => c === `superpowers:${n}`)
  return ha('writing-plans') && (ha('subagent-driven-development') || ha('executing-plans'))
}

export const slug = (testo: string) =>
  testo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-') || 'piano'

const data = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dove il flusso interno scrive il piano: il pannello lo segue da subito. */
export const percorsoPiano = (obiettivo: string, adesso: number) => `docs/plans/${data(adesso)}-${slug(obiettivo)}.md`

export function promptSuperpowers(obiettivo: string): string {
  return [
    'Nuovo piano di lavoro richiesto dal pannello Superpowers status.',
    '',
    'Obiettivo:',
    obiettivo,
    '',
    'Segui il flusso superpowers, una skill dopo l\'altra:',
    '1. superpowers:brainstorming: chiarisci requisiti e design, facendo le domande che servono.',
    '2. superpowers:writing-plans: scrivi il piano con un `### Task N: titolo` per task e i passi come checkbox `- [ ]`.',
    '3. Esegui il piano con superpowers:subagent-driven-development (registro in .superpowers/sdd); se i subagenti non sono disponibili, con superpowers:executing-plans.',
  ].join('\n')
}

export function promptInterno(obiettivo: string, percorso: string): string {
  return [
    'Nuovo piano di lavoro richiesto dal pannello Superpowers status.',
    '',
    'Obiettivo:',
    obiettivo,
    '',
    'Procedi così:',
    '1. Esplora il codice quanto basta per capire dove intervenire; fai domande solo se senza risposta non puoi procedere.',
    `2. Scrivi il piano in \`${percorso}\`: un titolo \`# ...\`, poi per ogni task \`### Task N: titolo\` seguito dai passi come checkbox \`- [ ] ...\`, piccoli e verificabili.`,
    '3. Esegui i task in ordine. Appena completi un passo, spunta la sua checkbox nel file (`- [x]`): il pannello legge l\'avanzamento e calcola l\'ETA da lì.',
    '4. Alla fine di ogni task verifica (test, build o controllo equivalente) prima di passare al successivo; se qualcosa fallisce, correggi prima di proseguire.',
  ].join('\n')
}
