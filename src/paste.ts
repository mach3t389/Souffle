type FontSample = { size: number; weight: number; heading: boolean }

const legacySizes = [0, 10, 13, 16, 18, 24, 32, 48]
const namedSizes: Record<string, number> = {
 'xx-small': 9, 'x-small': 10, small: 13, medium: 16,
 large: 18, 'x-large': 24, 'xx-large': 32,
}

function declaredSize(node: HTMLElement, parentSize: number): number | null {
 const legacy = node.tagName === 'FONT' ? node.getAttribute('size') : null
 if (legacy) {
  const number = Number(legacy)
  const index = /^[+-]/.test(legacy) ? 3 + number : number
  if (Number.isInteger(index) && index >= 1 && index <= 7) return legacySizes[index]
 }
 const value = node.style.fontSize.trim().toLowerCase()
 const match = /^(\d+(?:\.\d+)?)(px|pt|rem|em|%)$/.exec(value)
 if (match) {
  const amount = Number(match[1])
  const unit = match[2]
  return unit === 'pt' ? amount * 4 / 3
   : unit === 'rem' ? amount * 18
   : unit === 'em' ? amount * parentSize
   : unit === '%' ? amount * parentSize / 100 : amount
 }
 if (value in namedSizes) return namedSizes[value]
 if (value === 'smaller') return parentSize * .8
 if (value === 'larger') return parentSize * 1.2
 if (!value && node.tagName === 'SMALL') return parentSize * .8
 return null
}

export function pasteScale(samples: FontSample[]): number {
 const body = samples.filter(sample => !sample.heading)
 const candidates = (body.length ? body : samples).filter(sample => sample.size > 0 && sample.weight > 0).sort((a, b) => a.size - b.size)
 const total = candidates.reduce((sum, sample) => sum + sample.weight, 0)
 if (!total) return 1
 let weight = 0
 for (const sample of candidates) {
  weight += sample.weight
  if (weight >= total / 2) return Math.max(1, 18 / sample.size)
 }
 return 1
}

export function pastedSize(size: number, scale: number): number {
 return Math.round(Math.max(18, Math.min(48, size * scale)))
}

export function readablePastedHtml(html: string): string {
 const template = document.createElement('template')
 template.innerHTML = html
 const styled: Array<{ node: HTMLElement; size: number }> = []
 const samples: FontSample[] = []
 function visit(node: Node, inherited: number, heading: boolean): void {
  if (node.nodeType === 3) {
   const weight = (node.textContent || '').trim().length
   if (weight) samples.push({ size: inherited, weight, heading })
   return
  }
  if (node.nodeType === 1) {
   const element = node as HTMLElement
   if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(element.tagName)) return
   const declared = declaredSize(element, inherited)
   if (declared !== null) styled.push({ node: element, size: declared })
   inherited = declared === null ? inherited : declared
   heading = heading || /^H[1-6]$/.test(element.tagName)
  }
  for (const child of Array.from(node.childNodes)) visit(child, inherited, heading)
 }
 visit(template.content, 18, false)
 const scale = pasteScale(samples)
 for (const { node, size } of styled) {
  node.style.fontSize = `${pastedSize(size, scale)}px`
  if (node.tagName === 'FONT') node.removeAttribute('size')
 }
 return template.innerHTML
}
