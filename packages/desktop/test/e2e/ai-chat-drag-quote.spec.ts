import { expect, test, type Page } from '@playwright/test'
import { launchWithMarkdown } from './helpers'

const md =
  '# Heading one\n\nFirst paragraph with some selectable text here.\n\nSecond paragraph follows with more words.\n'

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

// Plants a DOM selection without keyboard input: muya re-reads the native
// selection when the drag gesture starts, so no synthetic keys are needed.
const selectParagraph = (page: Page, needle: string): Promise<boolean> =>
  page.evaluate((needle) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (!root) return false
    root.focus()
    const span = Array.from(root.querySelectorAll<HTMLElement>('span.mu-paragraph-content'))
      .find(el => (el.textContent ?? '').includes(needle))
    if (!span) return false
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return true
  }, needle)

const openAiPanel = async(page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.click('.ai-chat-fab')
  await page.waitForSelector('.ai-chat-panel', { state: 'visible' })
}

// Drag the given selection rects' first line into the composer and wait until
// the drag preview reaches it (pointer events are rAF-coalesced, so a fixed
// delay races the renderer).
const dragIntoComposer = async(
  page: Page,
  rect: { l: number; t: number; r: number; b: number },
  dropPoint: { x: number; y: number }
): Promise<void> => {
  const startX = (rect.l + rect.r) / 2
  const startY = (rect.t + rect.b) / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 30, startY + 10, { steps: 5 })
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 20 })
  await page.waitForFunction(() => {
    const preview = document.querySelector('.mu-text-drag-preview') as HTMLElement | null
    return !!preview && preview.getBoundingClientRect().top > 500
  }, null, { timeout: 5000 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

const composerCenter = async(page: Page): Promise<{ x: number; y: number }> => {
  const box = await page.locator('.chat-composer').boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + 40 }
}

const firstSelectionRect = async(
  page: Page,
  replant?: () => Promise<boolean>
): Promise<{ l: number; t: number; r: number; b: number }> => {
  // The editor window shares the live desktop, so stray focus changes can
  // clear a just-planted selection; re-plant once before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const rects = await page.evaluate(() => {
      const sel = window.getSelection()!
      if (!sel.rangeCount) return null
      return Array.from(sel.getRangeAt(0).getClientRects())
        .map(r => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }))
        .filter(r => r.r > r.l)
    })
    if (rects && rects.length > 0) return rects[0]!
    if (!replant) break
    expect(await replant()).toBe(true)
    await page.waitForTimeout(200)
  }
  throw new Error('selection has no client rects')
}

test('AI panel stays below the window controls in custom title bar mode', async() => {
  const { app, page } = await launchWithMarkdown(md, { preferences: { titleBarStyle: 'custom' } })
  await openAiPanel(page)
  await page.waitForTimeout(200)

  const boxes = await page.evaluate(() => {
    const rect = (sel: string): Box | null => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    return {
      controls: rect('.window-controls'),
      header: rect('.panel-header'),
      marginTop: getComputedStyle(document.querySelector('.ai-chat-panel')!).marginTop
    }
  })
  // The fork draws its own window controls at the top-right of the content
  // area; the panel must start below that strip, not under it.
  expect(boxes.controls).not.toBeNull()
  expect(boxes.header).not.toBeNull()
  expect(boxes.marginTop).not.toBe('0px')
  expect(boxes.header!.top).toBeGreaterThanOrEqual(boxes.controls!.bottom - 1)
  await app.close()
})

test('dragging editor text into the composer quotes it with a source range', async() => {
  const { app, page } = await launchWithMarkdown(md, { preferences: { titleBarStyle: 'custom' } })
  await openAiPanel(page)
  const dropPoint = await composerCenter(page)

  // Same-block selection: quotes one paragraph.
  expect(await selectParagraph(page, 'First paragraph')).toBe(true)
  await page.waitForTimeout(200)
  await dragIntoComposer(page, await firstSelectionRect(page, () => selectParagraph(page, 'First paragraph')), dropPoint)

  const after = await page.evaluate(() => ({
    previewGone: !document.querySelector('.mu-text-drag-preview'),
    hoverCleared: !document.querySelector('.chat-composer.is-dragover'),
    chip: document.querySelector('.reference-chip')?.textContent ?? null,
    location: document.querySelector('.reference-location')?.textContent ?? null
  }))
  expect(after.previewGone).toBe(true)
  expect(after.hoverCleared).toBe(true)
  expect(after.chip).toContain('First paragraph')
  expect(after.location).toBe('¶2')
  await app.close()
})

test('cross-block selection drags as a copy-only quote', async() => {
  const { app, page } = await launchWithMarkdown(md, { preferences: { titleBarStyle: 'custom' } })
  await openAiPanel(page)
  const dropPoint = await composerCenter(page)

  // Selection spanning the heading and the second paragraph.
  const plantCrossBlock = (): Promise<string> =>
    page.evaluate(() => {
      const root = document.querySelector('.editor-component') as HTMLElement | null
      if (!root) return 'no root'
      root.focus()
      const heading = root.querySelector<HTMLElement>('span.mu-atxheading-content')
      const para = Array.from(root.querySelectorAll<HTMLElement>('span.mu-paragraph-content'))
        .find(el => (el.textContent ?? '').includes('Second paragraph'))
      if (!heading?.firstChild || !para) return 'missing blocks'
      const range = document.createRange()
      range.setStart(heading.firstChild, 0)
      range.setEnd(para, para.childNodes.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return 'ok'
    })
  expect(await plantCrossBlock()).toBe('ok')
  await page.waitForTimeout(200)
  await dragIntoComposer(page, await firstSelectionRect(page, async() => (await plantCrossBlock()) === 'ok'), dropPoint)

  const after = await page.evaluate(() => ({
    chips: document.querySelectorAll('.reference-chip').length,
    chip: document.querySelector('.reference-chip')?.textContent ?? null,
    location: document.querySelector('.reference-location')?.textContent ?? null,
    editorIntact: (document.querySelector('.editor-component')?.textContent ?? '').includes('Heading one')
  }))
  expect(after.chips).toBe(1)
  expect(after.location).toBe('¶1–¶3')
  // Cross-block drops are quote-only: the document stays untouched.
  expect(after.editorIntact).toBe(true)
  await app.close()
})
