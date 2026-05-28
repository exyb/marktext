import { generateGithubSlug } from '../utils/url'

const tocCtrl = (ContentState) => {
  ContentState.prototype.getTOC = function() {
    const { blocks } = this
    const toc = []
    console.log('[tocCtrl] getTOC called, blocks count:', blocks?.length ?? 0)

    for (const block of blocks) {
      if (/^h\d$/.test(block.type)) {
        const { headingStyle, key, type } = block
        const child = block.children?.[0]
        if (!child || typeof child.text !== 'string') {
          console.warn('[tocCtrl] skip heading block, child invalid:', { key, type, children: block.children })
          continue
        }
        const { text } = child
        const content =
          headingStyle === 'setext' ? text.trim() : text.replace(/^\s*#{1,6}\s{1,}/, '').trim()
        const lvl = +type.substring(1)
        const slug = key
        toc.push({
          content,
          lvl,
          slug,
          githubSlug: generateGithubSlug(content)
        })
      }
    }

    console.log('[tocCtrl] generated toc count:', toc.length)
    return toc
  }
}

export default tocCtrl
