import { marked } from 'marked'
import { sanitize, PREVIEW_DOMPURIFY_CONFIG } from '@/util/dompurify'

/**
 * Renders assistant chat text to sanitized HTML. The preview profile keeps
 * svg/svgFilters enabled, which matches what the editor's html-block preview
 * allows, so inline diagrams in replies behave like inserted ones.
 */
export const renderChatMarkdown = (text: string): string => {
  const html = marked.parse(text, { async: false, breaks: true, gfm: true })
  return sanitize(html, PREVIEW_DOMPURIFY_CONFIG)
}
