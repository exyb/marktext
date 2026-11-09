import { SelectionType } from '@muyajs/core'
import type { Muya, TState } from '@muyajs/core'
import { sanitize, PREVIEW_DOMPURIFY_CONFIG } from '@/util/dompurify'

export interface AiToolExecution {
  ok: boolean
  result: string
}

interface ActiveAiEditor {
  muya: Muya
  // Read-only state is dynamic (preference + file state), so it is read
  // through a callback at tool execution time.
  getReadOnly: () => boolean
}

let activeEditor: ActiveAiEditor | null = null

export const setActiveAiEditor = (editor: ActiveAiEditor | null): void => {
  activeEditor = editor
}

export const hasActiveAiEditor = (): boolean => activeEditor !== null

export const getActiveDocumentMarkdown = (): string | null => {
  if (!activeEditor) return null
  return activeEditor.muya.getMarkdown()
}

/** Pure helper so the uniqueness rules are unit-testable without muya. */
export const applyUniqueReplacement = (
  markdown: string,
  search: string,
  replace: string
): { ok: boolean; nextMarkdown?: string; reason?: string } => {
  if (!search) return { ok: false, reason: 'search 不能为空' }
  const first = markdown.indexOf(search)
  if (first < 0) return { ok: false, reason: '在文档中找不到 search 文本,请逐字从文档复制后再试' }
  if (markdown.indexOf(search, first + search.length) >= 0) {
    return { ok: false, reason: 'search 文本在文档中出现多次,请加入更多上下文使其唯一' }
  }
  return {
    ok: true,
    nextMarkdown: markdown.slice(0, first) + replace + markdown.slice(first + search.length)
  }
}

const MAX_SVG_LENGTH = 512 * 1024

const insertIndexFromSelection = (states: TState[]): number => {
  if (!activeEditor) return states.length
  const selection = activeEditor.muya.getSelectionState()
  if (!selection || selection.kind !== SelectionType.TEXT) return states.length
  const topLevel = selection.anchor.path[0]
  return typeof topLevel === 'number' && topLevel >= 0 && topLevel < states.length
    ? topLevel + 1
    : states.length
}

const insertSvg = (svg: string): AiToolExecution => {
  if (!activeEditor) return { ok: false, result: '没有打开的文档' }
  const trimmed = svg.trim()
  if (!trimmed.toLowerCase().startsWith('<svg')) {
    return { ok: false, result: 'svg 参数必须是以 <svg 开头的完整 <svg>...</svg> 元素' }
  }
  if (trimmed.length > MAX_SVG_LENGTH) {
    return { ok: false, result: 'SVG 内容过大' }
  }
  // One physical line: CommonMark html blocks end at blank lines, so a
  // multi-line SVG would reparse as several blocks and break the round trip.
  const oneLine = trimmed.replace(/\r?\n/g, ' ')
  const clean = sanitize(oneLine, PREVIEW_DOMPURIFY_CONFIG)
  if (!clean.toLowerCase().includes('<svg')) {
    return { ok: false, result: 'SVG 内容未通过安全过滤' }
  }

  const { muya } = activeEditor
  const states = muya.getState()
  const selection = muya.getSelectionState()
  const insertIndex = insertIndexFromSelection(states)
  const svgBlock: TState = { name: 'html-block', text: clean }
  states.splice(insertIndex, 0, svgBlock)
  const applied = muya.replaceContent(states, selection)
  if (!applied) return { ok: false, result: '插入 SVG 失败(文档内容没有变化)' }
  return { ok: true, result: 'SVG 图谱已插入文档' }
}

const updateDocument = (newMarkdown: string): AiToolExecution => {
  if (!activeEditor) return { ok: false, result: '没有打开的文档' }
  if (!newMarkdown.trim()) return { ok: false, result: 'new_markdown 不能为空' }
  const { muya } = activeEditor
  const applied = muya.replaceContent(newMarkdown, muya.getSelectionState())
  if (!applied) return { ok: false, result: '文档内容没有变化' }
  return { ok: true, result: '文档已更新' }
}

const replaceText = (search: string, replace: string): AiToolExecution => {
  if (!activeEditor) return { ok: false, result: '没有打开的文档' }
  const replacement = applyUniqueReplacement(activeEditor.muya.getMarkdown(), search, replace)
  if (!replacement.ok || replacement.nextMarkdown === undefined) {
    return { ok: false, result: replacement.reason ?? '替换失败' }
  }
  const { muya } = activeEditor
  const applied = muya.replaceContent(replacement.nextMarkdown, muya.getSelectionState())
  if (!applied) return { ok: false, result: '文档内容没有变化' }
  return { ok: true, result: '文档片段已替换' }
}

/** Guards are evaluated per call: document state can change between rounds. */
export const executeAiTool = async(call: {
  name: string
  args: Record<string, unknown>
}): Promise<AiToolExecution> => {
  if (!activeEditor) return { ok: false, result: '没有打开的文档' }
  if (activeEditor.getReadOnly()) return { ok: false, result: '文档是只读的,无法修改' }

  switch (call.name) {
    case 'update_document':
      return updateDocument(String(call.args.new_markdown ?? ''))
    case 'replace_text':
      return replaceText(String(call.args.search ?? ''), String(call.args.replace ?? ''))
    case 'insert_svg':
      return insertSvg(String(call.args.svg ?? ''))
    default:
      return { ok: false, result: `未知工具: ${call.name}` }
  }
}

/** First fenced code block in a message whose content holds an SVG. */
export const extractSvgFence = (text: string): string | null => {
  const fence = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text)
  if (!fence) return null
  const content = fence[1].trim()
  return content.toLowerCase().startsWith('<svg') ? content : null
}
