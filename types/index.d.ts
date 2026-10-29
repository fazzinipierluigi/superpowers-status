// Stato del pannello "Superpowers status".

export type Passo = { testo: string; fatto: boolean }

export type TaskPiano = {
  id: string
  titolo: string
  /** completo | in lavorazione | revisione | correzioni | consegnato | in coda */
  fase: string
  passi: Passo[]
  /** id dei subagenti indicati nel registro per questo task */
  agenti: string[]
  /** Chiave dei tempi quando l'id non è stabile (to-do: il testo). Assente: l'id. */
  chiave?: string
}

/** Da dove viene il piano: registro superpowers, lista task di Claude Code, to-do, file markdown con checkbox. */
export type Fonte = 'superpowers' | 'task' | 'todo' | 'file'

/** `nome` è la chiave (tempi, nascosti); `titolo` ciò che si mostra, se diverso. */
export type Piano = { nome: string; task: TaskPiano[]; fonte?: Fonte; titolo?: string }

/** Un task della lista di Claude Code (TaskCreate / TaskUpdate). */
export type TaskLibero = { id: string; titolo: string; stato: 'pending' | 'in_progress' | 'completed'; descrizione: string }

/** Un file markdown con checkbox seguito come piano. */
export type FileTracciato = { percorso: string; visto: number }

export type InfoAgente = { id: string; descrizione: string; tipo: string; stato: string }

/** Attività di un subagente vista dagli eventi: chiamate, ultimo strumento, ultimo istante. */
export type Attivita = { chiamate: number; ultimo: string; quando: number; esito?: string }

/** Tempi misurati di un task: quando è diventato attivo, quando è finito, quanti passi aveva. */
export type Tempo = { inizio: number; fine?: number; passi: number }

/** Tempi per piano (nome cartella) e per task (id). */
export type Tempi = Record<string, Record<string, Tempo>>

/** Un piano appena chiesto dal pannello, finché il piano vero non compare. */
export type Avvio = {
  obiettivo: string
  via: 'superpowers' | 'interno'
  quando: number
  /** Piani già presenti all'avvio: il primo nome nuovo è il piano partito. */
  pianiPrima: string[]
  percorso?: string
}

/** Il riquadro per scrivere un nuovo piano: aperto o no, e quale flusso usare. */
export type Composer = { aperto: boolean; modo: 'auto' | 'superpowers' | 'interno' }

export type Todo = { testo: string; stato: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'superpowers-status': {
      piani: Shaped<Piano[]>
      agenti: Shaped<InfoAgente[]>
      attivita: Shaped<Record<string, Attivita>>
      todo: Shaped<Todo[]>
      ora: Shaped<number>
      /** Piani finiti nascosti dall'utente (nomi delle cartelle in .superpowers/sdd); copia di $.store. */
      nascosti: Shaped<string[]>
      /** Mostra anche i piani nascosti, attenuati, per ripristinarli. */
      mostraNascosti: Shaped<boolean>
      /** Tempi misurati dei task, copia di $.store: base delle ETA. */
      tempi: Shaped<Tempi>
      /** Lista task di Claude Code di questa sessione. */
      taskLiberi: Shaped<TaskLibero[]>
      composer: Shaped<Composer>
      /** Task in coda o completato aperto nel pannello, per piano: nome del piano → id ('' nessuno). */
      espansi: Shaped<Record<string, string>>
      avvio: Shaped<Avvio | null>
      /** Le skill superpowers per il flusso completo ci sono in questa sessione. */
      superpowers: Shaped<boolean>
    }
  }
}
