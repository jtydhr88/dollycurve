/** Lightweight DOM context menu, shared by Timeline and GraphEditor.
 * One-level only — `separator: true` draws a divider, an entry with no
 * `action` renders as a section label. If any item is `checked: true`,
 * all action-rows reserve a leading "check" column so labels align;
 * the checked item shows ✓. */
export interface MenuItem {
  label?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
  checked?: boolean
}

const MENU_STYLE_ID = 'ckp-menu-style'
const MENU_STYLE = `
.ckp-menu {
  position: fixed; z-index: 9999;
  background: #2a2a30; border: 1px solid #444; border-radius: 4px;
  padding: 4px 0; min-width: 180px;
  font: 12px system-ui, sans-serif; color: #ddd;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  user-select: none;
}
.ckp-menu-item { padding: 4px 14px; cursor: pointer; display: flex; align-items: baseline; gap: 6px; }
.ckp-menu-item:hover { background: #3a3a44; color: #fff; }
.ckp-menu-item.disabled { color: #666; cursor: default; }
.ckp-menu-item.disabled:hover { background: transparent; color: #666; }
.ckp-menu-check { width: 12px; flex-shrink: 0; color: #ffd54a; text-align: center; }
.ckp-menu-section { padding: 4px 14px 2px; color: #777; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; cursor: default; }
.ckp-menu-sep { height: 1px; background: #3a3a44; margin: 4px 0; }
`

export function showSimpleMenu (clientX: number, clientY: number, items: MenuItem[]): void {
  if (!document.getElementById(MENU_STYLE_ID)) {
    const tag = document.createElement('style')
    tag.id = MENU_STYLE_ID
    tag.textContent = MENU_STYLE
    document.head.appendChild(tag)
  }
  document.querySelectorAll('.ckp-menu').forEach((m) => m.remove())

  const menu = document.createElement('div')
  menu.className = 'ckp-menu'
  const hasCheckable = items.some((it) => it.checked !== undefined)
  for (const it of items) {
    if (it.separator) {
      const s = document.createElement('div')
      s.className = 'ckp-menu-sep'
      menu.appendChild(s)
      continue
    }
    if (!it.action) {
      const s = document.createElement('div')
      s.className = 'ckp-menu-section'
      s.textContent = it.label ?? ''
      menu.appendChild(s)
      continue
    }
    const div = document.createElement('div')
    div.className = 'ckp-menu-item' + (it.disabled ? ' disabled' : '')
    if (hasCheckable) {
      const check = document.createElement('span')
      check.className = 'ckp-menu-check'
      check.textContent = it.checked ? '✓' : ''
      div.appendChild(check)
    }
    const label = document.createElement('span')
    label.textContent = it.label ?? ''
    div.appendChild(label)
    if (!it.disabled) {
      div.addEventListener('click', () => {
        it.action!()
        menu.remove()
      })
    }
    menu.appendChild(div)
  }
  document.body.appendChild(menu)

  const rect = menu.getBoundingClientRect()
  const px = Math.min(clientX, window.innerWidth - rect.width - 8)
  const py = Math.min(clientY, window.innerHeight - rect.height - 8)
  menu.style.left = px + 'px'
  menu.style.top = py + 'px'

  const close = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return
    if (e instanceof MouseEvent && menu.contains(e.target as Node)) return
    menu.remove()
    window.removeEventListener('mousedown', close as EventListener)
    window.removeEventListener('keydown', close as EventListener)
  }
  // Defer attach so the originating event doesn't immediately close.
  setTimeout(() => {
    window.addEventListener('mousedown', close as EventListener)
    window.addEventListener('keydown', close as EventListener)
  }, 0)
}
