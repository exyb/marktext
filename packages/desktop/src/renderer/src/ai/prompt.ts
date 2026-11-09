import type { AiToolSchema } from '@shared/types/aiChat'

export const AI_SYSTEM_PROMPT = `You are MarkText Copilot, an assistant embedded in the MarkText markdown editor. You help the user write, edit and enrich the currently open markdown document.

General rules:
- Reply in the language the user writes in (Chinese prompt -> Chinese reply).
- Be concise. Use markdown formatting in your replies.
- When asked to modify the document, use the provided tools instead of describing the change:
  - \`replace_text\` for small targeted edits. The \`search\` string must appear exactly once in the current document; copy it verbatim from the document content provided to you and include enough surrounding context to keep it unique.
  - \`update_document\` for structural or wide-ranging rewrites. Pass the complete revised markdown; everything except the parts you intend to change must stay byte-identical.
- When the user asks for a diagram, chart, sketch or illustration (图/图表/示意图/流程图), generate it as a single self-contained SVG and call \`insert_svg\`:
  - The SVG must be one self-contained \`\`<svg>...</svg>\`\` element with explicit \`viewBox\` and \`width\`/\`height\` attributes.
  - Use only static SVG shapes and text; no scripts, no external images/fonts, no foreignObject, no blank lines inside the SVG.
  - Prefer readable font sizes, soft colors on a transparent background, and Chinese labels when the user writes Chinese.
- After calling a tool, briefly confirm what you changed. Do not paste the full document or the SVG back into your reply.`

// The schema lives next to the prompt so tool descriptions and the system
// rules stay in sync when one changes.
export const AI_TOOLS: AiToolSchema[] = [
  {
    name: 'replace_text',
    description:
      'Replace one unique snippet in the current document. `search` must match exactly once, copied verbatim from the document content.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Exact text to replace, unique in the document' },
        replace: { type: 'string', description: 'Replacement text' }
      },
      required: ['search', 'replace']
    }
  },
  {
    name: 'update_document',
    description:
      'Replace the whole document with revised markdown. Keep untouched parts byte-identical, including line breaks.',
    parameters: {
      type: 'object',
      properties: {
        new_markdown: { type: 'string', description: 'The complete revised markdown document' }
      },
      required: ['new_markdown']
    }
  },
  {
    name: 'insert_svg',
    description:
      'Insert a generated SVG diagram below the current cursor position as an HTML block.',
    parameters: {
      type: 'object',
      properties: {
        svg: { type: 'string', description: 'Complete <svg>...</svg> markup on a single line' },
        alt: { type: 'string', description: 'Short description of the diagram' }
      },
      required: ['svg']
    }
  }
]

// Document content rides in the system message inside these delimiters so the
// model can tell it apart from its own instructions.
export const DOC_CONTEXT_HEADING = '当前文档内容 (Current document markdown):'
export const DOC_CONTEXT_MAX_LENGTH = 60000

export const buildSystemPrompt = (options: {
  docMarkdown: string | null
  references: Array<{ text: string; location?: string }>
  // Character budget for the document context; derived from the provider's
  // context window when configured, else the built-in default.
  maxDocChars?: number
}): string => {
  const sections: string[] = [AI_SYSTEM_PROMPT]
  if (options.docMarkdown) {
    const limit = options.maxDocChars ?? DOC_CONTEXT_MAX_LENGTH
    const truncated =
      options.docMarkdown.length > limit
        ? `${options.docMarkdown.slice(0, limit)}\n…(文档过长已截断)`
        : options.docMarkdown
    sections.push(
      `${DOC_CONTEXT_HEADING}\n<document>\n${truncated}\n</document>`
    )
  }
  if (options.references.length > 0) {
    const quoted = options.references
      .map((reference, index) => {
        const location = reference.location ? ` location="${reference.location}"` : ''
        return `<reference index="${index + 1}"${location}>\n${reference.text}\n</reference>`
      })
      .join('\n')
    sections.push(`用户引用的文本片段 (User references):\n${quoted}`)
  }
  return sections.join('\n\n---\n\n')
}
