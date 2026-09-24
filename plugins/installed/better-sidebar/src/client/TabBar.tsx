/**
 * The tab strip of one pane: tabs capped at TAB_MAX_WIDTH (ellipsized),
 * overflow scrolls horizontally, a close button per tab, a four-way split
 * button cluster, and the + menu that opens new tabs (explorer / git /
 * terminal). Tabs are draggable; dropping onto another tab inserts before it,
 * dropping on the strip background appends to this pane.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCloseFill14, IconPlusOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarTab } from './state.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** One + menu option. */
export interface NewTabOption {
  id: string
  label: string
  disabled?: boolean
  /** Leading icon (Menu row). */
  icon?: ReactNode
}

/** Drag payload for tab moves (HTML5 DnD dataTransfer). */
export const TAB_DRAG_TYPE = 'application/x-dsh-tab'

export interface TabDragPayload {
  tabId: string
  paneId: string
}

export function serializeDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload)
}

export function parseDrag(raw: string): TabDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as TabDragPayload
    if (typeof parsed.tabId === 'string' && typeof parsed.paneId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

/** Global tab-drag flag: PDF iframes become non-interactive synchronously. */
function setTabDragging(active: boolean): void {
  if (active) document.body.setAttribute('data-dsh-tab-dragging', '')
  else document.body.removeAttribute('data-dsh-tab-dragging')
}

export function TabBar(props: {
  paneId: string
  tabs: SidebarTab[]
  active: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: (optionId: string) => void
  newTabOptions: NewTabOption[]
  /** Drop of a tab from any pane: (payload, insertBeforeTabId | null). */
  onDropTab: (payload: TabDragPayload, before: string | null) => void
  /** Icon resolver for tab labels (reads from the tab descriptor registry). */
  getTabIcon?: (tab: SidebarTab) => ReactNode
  /** Badge resolver for tab labels (reads the descriptor's `badge`; the
   *  resolver returns the rendered pill or null). */
  getTabBadge?: (tab: SidebarTab) => ReactNode
}) {
  const {
    paneId, tabs, active, onActivate, onClose, onNewTab, newTabOptions, onDropTab, getTabIcon, getTabBadge,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)

  const setNewTabMenuOpen = (next: boolean) => {
    document.body.toggleAttribute('data-taskhive-sidebar-new-tab-open', next)
    setMenuOpen(next)
  }
  const closeNewTabMenu = () => { setNewTabMenuOpen(false) }

  const getSidebarBoundedAnchorRect = (): DOMRect | null => {
    const anchor = plusRef.current?.getBoundingClientRect()
    if (anchor === undefined) return null
    const panel = plusRef.current?.closest('[data-dsh-better-sidebar-panel="right"]')?.getBoundingClientRect()
    if (panel === undefined) return anchor
    const right = Math.max(panel.left + 8, panel.right - 8)
    return new DOMRect(right, anchor.top, 0, anchor.height)
  }

  // Wheel over the strip scrolls the tab row horizontally (a plain mouse
  // wheel emits deltaY, which overflow-x alone never consumes). Bound as a
  // native NON-passive listener: React registers onWheel passively at the
  // root, where preventDefault() is a no-op. Modifier keys keep their native
  // meaning (shift = horizontal scroll, ctrl/cmd = zoom), and a strip that
  // does not overflow leaves the event alone so the page scrolls normally.
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      if (el.scrollWidth <= el.clientWidth) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1
      el.scrollLeft += (event.deltaX + event.deltaY) * unit
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeNewTabMenu()
        plusRef.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const menu = [...document.body.children].find(node => node.getAttribute?.('role') === 'menu' && node.getClientRects().length > 0)
      const items = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])]
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowUp' ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length
      items[next]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [menuOpen])

  useEffect(() => () => { document.body.removeAttribute('data-taskhive-sidebar-new-tab-open') }, [])

  useEffect(() => {
    const clear = (): void => { setTabDragging(false); setDragOver(false) }
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return (
    <div
      className={clsx(css.tabBar, dragOver && css.tabBarDrop)}
      onDragOver={(event) => {
        // The strip owns drops on itself (merge into this pane); stopping
        // propagation keeps the pane root from also running its edge-zone
        // handler on the same drop.
        event.preventDefault()
        event.stopPropagation()
        setDragOver(true)
      }}
      onDragLeave={() => { setDragOver(false) }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragOver(false)
        setTabDragging(false)
        const raw = event.dataTransfer.getData(TAB_DRAG_TYPE)
        const payload = parseDrag(raw)
        if (payload !== null) onDropTab(payload, null)
      }}
    >
      <div ref={listRef} className={css.tabList}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={clsx(css.tab, active === tab.id && css.tabActive)}
            title={tab.title}
            draggable
            onDragStart={(event) => {
              setTabDragging(true)
              event.dataTransfer.setData(TAB_DRAG_TYPE, serializeDrag({ tabId: tab.id, paneId }))
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => { setTabDragging(false); setDragOver(false) }}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setTabDragging(false)
              const raw = event.dataTransfer.getData(TAB_DRAG_TYPE)
              const payload = parseDrag(raw)
              if (payload !== null) onDropTab(payload, tab.id)
            }}
            onClick={() => { onActivate(tab.id) }}
            onAuxClick={(event) => {
              // Middle-click closes the tab (and suppresses autoscroll).
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.id)
              }
            }}
          >
            {getTabIcon?.(tab) ?? null}
            {getTabBadge?.(tab) ?? null}
            <span className={css.tabTitle}>{tab.title}</span>
            <button
              type="button"
              className={css.tabClose}
              aria-label={t('close')}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
            >
              <IconCloseFill14 />
            </button>
          </div>
        ))}
        {/*
          The + sits immediately after the rightmost tab (sticky at the
          right edge of the scrollport when the tabs overflow, so it stays
          reachable no matter how many tabs are open).
        */}
        <Menu
          open={menuOpen}
          onClose={closeNewTabMenu}
          items={newTabOptions.map(option => ({
            id: option.id,
            label: option.label,
            ...(option.disabled === true ? { disabled: true } : {}),
            ...(option.icon !== undefined ? { icon: option.icon } : {}),
          }))}
          onSelect={(id) => {
            onNewTab(id)
            closeNewTabMenu()
          }}
          portal
          align="end"
          className={css.newTabMenu}
          getAnchorRect={getSidebarBoundedAnchorRect}
          anchor={(
            <button
              ref={plusRef}
              type="button"
              className={css.tabBarPlus}
              data-dsh-sidebar-new-tab
              aria-label={t('newTab')}
              title={t('newTab')}
              onClick={() => { setNewTabMenuOpen(!menuOpen) }}
            >
              <IconPlusOutline16 />
            </button>
          )}
        />
      </div>
    </div>
  )
}
