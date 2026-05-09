// Snapshot-based undo/redo, one step per user-intent command (mirrors
// Blender's per-operator-boundary push pattern — BKE_undosys, ed_undo.cc).

export interface UndoStackOptions<T> {
  /** Capture the full mutable state. */
  getSnapshot: () => T
  /** Restore a captured snapshot in place. Caller is responsible for
   * preserving any object identity that downstream listeners rely on. */
  applySnapshot: (s: T) => void
  /** Optional byte estimator for the maxBytes budget; defaults to JSON length. */
  estimateBytes?: (s: T) => number
  /** Cap on history depth. Default 64. */
  maxSteps?: number
  /** Cap on summed snapshot bytes. Default Infinity. */
  maxBytes?: number
  /** Fired after push / undo / redo / clear. */
  onChange?: () => void
}

interface UndoEntry<T> {
  label: string
  snapshot: T
  bytes: number
}

export class UndoStack<T> {
  private steps: UndoEntry<T>[] = []
  private cursor = -1
  private getSnapshot: () => T
  private applySnapshot: (s: T) => void
  private estimateBytes: (s: T) => number
  private maxSteps: number
  private maxBytes: number
  private onChange: () => void

  constructor (opts: UndoStackOptions<T>) {
    this.getSnapshot = opts.getSnapshot
    this.applySnapshot = opts.applySnapshot
    this.estimateBytes = opts.estimateBytes ?? ((s) => JSON.stringify(s).length)
    this.maxSteps = opts.maxSteps ?? 64
    this.maxBytes = opts.maxBytes ?? Infinity
    this.onChange = opts.onChange ?? (() => {})
  }

  /** Set initial baseline. Idempotent if stack already has entries. */
  setBaseline (label = 'initial'): void {
    if (this.steps.length > 0) return
    const snap = this.getSnapshot()
    this.steps.push({ label, snapshot: snap, bytes: this.estimateBytes(snap) })
    this.cursor = 0
    this.onChange()
  }

  /** Push a snapshot of current state. Trims any redo tail (Blender
   * ed_undo.cc:113-138). Enforces both maxSteps and maxBytes from oldest. */
  push (label: string): void {
    if (this.steps.length === 0) this.setBaseline()
    const snap = this.getSnapshot()
    const bytes = this.estimateBytes(snap)
    if (this.cursor < this.steps.length - 1) {
      this.steps.length = this.cursor + 1
    }
    this.steps.push({ label, snapshot: snap, bytes })
    this.cursor = this.steps.length - 1
    this.enforceLimits()
    this.onChange()
  }

  canUndo (): boolean { return this.cursor > 0 }
  canRedo (): boolean { return this.cursor < this.steps.length - 1 }

  undo (): boolean {
    if (!this.canUndo()) return false
    this.cursor--
    this.applySnapshot(this.steps[this.cursor].snapshot)
    this.onChange()
    return true
  }

  redo (): boolean {
    if (!this.canRedo()) return false
    this.cursor++
    this.applySnapshot(this.steps[this.cursor].snapshot)
    this.onChange()
    return true
  }

  /** Drop all history including the baseline. */
  clear (): void {
    this.steps.length = 0
    this.cursor = -1
    this.onChange()
  }

  /** Labels for a history menu, in chronological order. */
  history (): { label: string; current: boolean }[] {
    return this.steps.map((e, i) => ({ label: e.label, current: i === this.cursor }))
  }

  totalBytes (): number {
    let s = 0
    for (const e of this.steps) s += e.bytes
    return s
  }

  // Always keep at least one entry (the baseline) so future pushes have a
  // starting state to roll back to. Mirrors WITH_GLOBAL_UNDO_KEEP_ONE in
  // Blender's undo_system.cc.
  private enforceLimits (): void {
    while (this.steps.length > this.maxSteps && this.steps.length > 1) {
      this.steps.shift()
      this.cursor--
    }
    if (this.maxBytes !== Infinity) {
      let total = this.totalBytes()
      while (total > this.maxBytes && this.steps.length > 1) {
        const removed = this.steps.shift()!
        total -= removed.bytes
        this.cursor--
      }
    }
  }
}
