export function openLegacyDialog(d: HTMLDialogElement, body: HTMLElement) {
 d.classList.add('legacy-dialog')
 d.setAttribute('open', '')
 body.classList.add('legacy-dialog-open')
 ;(d as any).close = () => {
  d.removeAttribute('open')
  body.classList.remove('legacy-dialog-open')
  if (d.onclose) d.onclose(new Event('close'))
 }
 if (!Object.getOwnPropertyDescriptor(d, 'open')) {
  Object.defineProperty(d, 'open', { configurable: true, get: () => d.hasAttribute('open') })
 }
}
