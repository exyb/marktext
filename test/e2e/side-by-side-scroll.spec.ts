import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as path from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady, clickMenuById } from './helpers'

const testMdPath = path.resolve('/home/bobo/Files/Work/repo-public/github/marktext/test.md')

const enterSideBySide = async (page: Page, app: ElectronApplication) => {
  await clickMenuById(app, 'sideBySideModeMenuItem')
  await page.waitForSelector('.container.side-by-side', { timeout: 10000 })
  await page.waitForSelector('.source-code .CodeMirror', { state: 'attached', timeout: 10000 })
  await page.waitForTimeout(2000)
}

const exitSideBySide = async (page: Page, app: ElectronApplication) => {
  await clickMenuById(app, 'sideBySideModeMenuItem')
  await page.waitForTimeout(500)
}

const getScrollRatios = () => {
  const muyaEl = document.querySelector('.container.side-by-side .editor-component') as HTMLElement | null
  const cmContainer = document.querySelector('.source-code') as HTMLElement | null

  const muyaMax = muyaEl ? Math.max(muyaEl.scrollHeight - muyaEl.clientHeight, 1) : 1
  const cmMax = cmContainer ? Math.max(cmContainer.scrollHeight - cmContainer.clientHeight, 1) : 1

  return {
    muyaScrollTop: muyaEl?.scrollTop ?? -1,
    muyaScrollHeight: muyaEl?.scrollHeight ?? 0,
    muyaClientHeight: muyaEl?.clientHeight ?? 0,
    muyaRatio: muyaEl ? muyaEl.scrollTop / muyaMax : -1,
    cmScrollTop: cmContainer?.scrollTop ?? -1,
    cmScrollHeight: cmContainer?.scrollHeight ?? 0,
    cmClientHeight: cmContainer?.clientHeight ?? 0,
    cmRatio: cmContainer ? cmContainer.scrollTop / cmMax : -1
  }
}

const scrollMuyaTo = (ratio: number) => {
  const muya = document.querySelector('.container.side-by-side .editor-component') as HTMLElement | null
  if (muya) {
    const maxScroll = muya.scrollHeight - muya.clientHeight
    muya.scrollTop = maxScroll * ratio
  }
}

const scrollCmTo = (ratio: number) => {
  const container = document.querySelector('.source-code') as HTMLElement | null
  if (container) {
    const maxScroll = container.scrollHeight - container.clientHeight
    container.scrollTop = maxScroll * ratio
  }
}

test.describe('Side-by-side proportional scroll synchronization', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchElectron([testMdPath])
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('Muya → CM: scrolling reading view syncs source view proportionally', async () => {
    await enterSideBySide(page, app)

    const positions = [0.25, 0.5, 0.75]
    for (const targetRatio of positions) {
      await page.evaluate(scrollMuyaTo, targetRatio)
      await page.waitForTimeout(600)

      const state = await page.evaluate(getScrollRatios)
      const delta = Math.abs(state.muyaRatio - state.cmRatio)

      expect(
        delta,
        `At Muya ${targetRatio * 100}%: muyaRatio=${state.muyaRatio.toFixed(3)} cmRatio=${state.cmRatio.toFixed(3)} delta=${delta.toFixed(3)}`
      ).toBeLessThan(0.08)
    }

    await exitSideBySide(page, app)
  })

  test('CM → Muya: scrolling source view syncs reading view proportionally', async () => {
    await enterSideBySide(page, app)

    const positions = [0.25, 0.5, 0.75]
    for (const targetRatio of positions) {
      await page.evaluate(scrollCmTo, targetRatio)
      await page.waitForTimeout(600)

      const state = await page.evaluate(getScrollRatios)
      const delta = Math.abs(state.muyaRatio - state.cmRatio)

      expect(
        delta,
        `At CM ${targetRatio * 100}%: muyaRatio=${state.muyaRatio.toFixed(3)} cmRatio=${state.cmRatio.toFixed(3)} delta=${delta.toFixed(3)}`
      ).toBeLessThan(0.08)
    }

    await exitSideBySide(page, app)
  })

  test('scrolling Muya to top syncs CM to top', async () => {
    await enterSideBySide(page, app)

    await page.evaluate(scrollMuyaTo, 0.5)
    await page.waitForTimeout(600)

    await page.evaluate(scrollMuyaTo, 0)
    await page.waitForTimeout(600)

    const state = await page.evaluate(getScrollRatios)
    expect(state.cmScrollTop).toBeLessThan(50)

    await exitSideBySide(page, app)
  })

  test('scrolling CM to top syncs Muya to top', async () => {
    await enterSideBySide(page, app)

    await page.evaluate(scrollCmTo, 0.5)
    await page.waitForTimeout(600)

    await page.evaluate(scrollCmTo, 0)
    await page.waitForTimeout(600)

    const state = await page.evaluate(getScrollRatios)
    expect(state.muyaScrollTop).toBeLessThan(50)

    await exitSideBySide(page, app)
  })

  test('scrolling Muya to bottom syncs CM near bottom', async () => {
    await enterSideBySide(page, app)

    await page.evaluate(scrollMuyaTo, 1.0)
    await page.waitForTimeout(600)

    const state = await page.evaluate(getScrollRatios)
    const cmMax = state.cmScrollHeight - state.cmClientHeight
    expect(state.cmScrollTop).toBeGreaterThan(cmMax * 0.85)

    await exitSideBySide(page, app)
  })

  test('scrolling CM to bottom syncs Muya near bottom', async () => {
    await enterSideBySide(page, app)

    await page.evaluate(scrollCmTo, 1.0)
    await page.waitForTimeout(600)

    const state = await page.evaluate(getScrollRatios)
    const muyaMax = state.muyaScrollHeight - state.muyaClientHeight
    expect(state.muyaScrollTop).toBeGreaterThan(muyaMax * 0.85)

    await exitSideBySide(page, app)
  })

  test('alternating scrolls stay synchronized', async () => {
    await enterSideBySide(page, app)

    await page.evaluate(scrollMuyaTo, 0.3)
    await page.waitForTimeout(600)
    let state = await page.evaluate(getScrollRatios)
    expect(Math.abs(state.muyaRatio - state.cmRatio)).toBeLessThan(0.08)

    await page.evaluate(scrollCmTo, 0.6)
    await page.waitForTimeout(600)
    state = await page.evaluate(getScrollRatios)
    expect(Math.abs(state.muyaRatio - state.cmRatio)).toBeLessThan(0.08)

    await page.evaluate(scrollMuyaTo, 0.8)
    await page.waitForTimeout(600)
    state = await page.evaluate(getScrollRatios)
    expect(Math.abs(state.muyaRatio - state.cmRatio)).toBeLessThan(0.08)

    await exitSideBySide(page, app)
  })
})
