import { generateGithubSlug } from '../utils/url'

const tocCtrl = (ContentState) => {
  ContentState.prototype.getTOC = function() {
    const { blocks } = this
    const toc = []

    for (const block of blocks) {
      if (/^h\d$/.test(block.type)) {
        const { headingStyle, key, type } = block
        const child = block.children?.[0]
        if (!child || typeof child.text !== 'string') {
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

    return toc
  }
}

export default tocCtrl
