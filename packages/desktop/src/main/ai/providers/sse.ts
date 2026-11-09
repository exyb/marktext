/**
 * Minimal SSE body consumer for the LLM proxies. Both providers we support
 * only need the `data:` lines; event framing, comments and the retry/id
 * fields are irrelevant here.
 */

type DataHandler = (data: string) => void

export const consumeSseStream = async(
  body: ReadableStream<Uint8Array>,
  onData: DataHandler
): Promise<void> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dataLines: string[] = []

  const flush = (): void => {
    if (dataLines.length > 0) {
      onData(dataLines.join('\n'))
      dataLines.length = 0
    }
  }

  const consumeLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    // An empty line closes the current event; multiple `data:` lines join with \n.
    if (line === '') {
      flush()
      return
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    consumeLine(buffer)
    flush()
  } finally {
    // Stop interrupted or oversized streams instead of leaving them pending.
    await reader.cancel().catch(() => {})
  }
}
