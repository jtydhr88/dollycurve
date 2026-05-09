import { describe, it, expect } from 'vitest'
import { UndoStack } from './UndoStack'

interface S { value: number }

function makeStack (initial: S, opts: Partial<{ maxSteps: number; maxBytes: number }> = {}) {
  const state: S = { ...initial }
  const stack = new UndoStack<S>({
    getSnapshot: () => ({ value: state.value }),
    applySnapshot: (s) => { state.value = s.value },
    maxSteps: opts.maxSteps,
    maxBytes: opts.maxBytes,
  })
  stack.setBaseline()
  return { state, stack }
}

describe('UndoStack', () => {
  it('baseline + push + undo restores prior state', () => {
    const { state, stack } = makeStack({ value: 0 })
    state.value = 5
    stack.push('first')
    state.value = 9
    stack.push('second')
    expect(stack.canUndo()).toBe(true)
    stack.undo()
    expect(state.value).toBe(5)
    stack.undo()
    expect(state.value).toBe(0)
    expect(stack.canUndo()).toBe(false)
  })

  it('redo replays after undo', () => {
    const { state, stack } = makeStack({ value: 0 })
    state.value = 1; stack.push('a')
    state.value = 2; stack.push('b')
    stack.undo()
    expect(state.value).toBe(1)
    stack.redo()
    expect(state.value).toBe(2)
    expect(stack.canRedo()).toBe(false)
  })

  it('push after undo trims redo tail', () => {
    const { state, stack } = makeStack({ value: 0 })
    state.value = 1; stack.push('a')
    state.value = 2; stack.push('b')
    stack.undo()  // back to 1
    state.value = 99; stack.push('c')  // diverge
    expect(stack.canRedo()).toBe(false)
    stack.undo()
    expect(state.value).toBe(1)
  })

  it('respects maxSteps by trimming oldest, keeping baseline', () => {
    const { state, stack } = makeStack({ value: 0 }, { maxSteps: 3 })
    for (let i = 1; i <= 10; i++) {
      state.value = i; stack.push(`step${i}`)
    }
    // Stack should hold at most maxSteps (3) entries.
    expect(stack.history().length).toBeLessThanOrEqual(3)
    // Cursor still points at the most recent push.
    state.value = 0
    stack.undo()
    expect(state.value).toBe(9)  // one before the last push (10)
  })

  it('respects maxBytes', () => {
    const { state, stack } = makeStack({ value: 0 }, { maxBytes: 100 })
    for (let i = 1; i <= 50; i++) {
      state.value = i; stack.push(`step${i}`)
    }
    // Each snapshot is ~13 bytes JSON; with 100-byte cap we keep <10.
    expect(stack.totalBytes()).toBeLessThanOrEqual(100 + 30)  // small slop
  })

  it('clear empties the stack', () => {
    const { state, stack } = makeStack({ value: 0 })
    state.value = 1; stack.push('a')
    stack.clear()
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
    expect(stack.history().length).toBe(0)
  })

  it('history reports current cursor', () => {
    const { state, stack } = makeStack({ value: 0 })
    state.value = 1; stack.push('a')
    state.value = 2; stack.push('b')
    stack.undo()
    const h = stack.history()
    expect(h.length).toBe(3)  // baseline + a + b
    expect(h[1].current).toBe(true)  // we're at "a"
  })

  it('onChange fires on push / undo / redo / clear', () => {
    const state: S = { value: 0 }
    let calls = 0
    const stack = new UndoStack<S>({
      getSnapshot: () => ({ value: state.value }),
      applySnapshot: (s) => { state.value = s.value },
      onChange: () => calls++,
    })
    stack.setBaseline()
    state.value = 1; stack.push('a')
    stack.undo()
    stack.redo()
    stack.clear()
    expect(calls).toBeGreaterThanOrEqual(5)
  })
})
