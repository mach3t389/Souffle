import assert from 'node:assert/strict'
import test from 'node:test'
import { openLegacyDialog } from '../src/legacy-dialog.ts'

test('the iPad dialog can close and reopen on the same element', () => {
 const attributes = new Set()
 const dialogClasses = new Set()
 const bodyClasses = new Set()
 let closed = 0
 const d = {
  classList: { add: name => dialogClasses.add(name) },
  setAttribute: name => attributes.add(name),
  removeAttribute: name => attributes.delete(name),
  hasAttribute: name => attributes.has(name),
  onclose: () => closed++,
 }
 const body = { classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) } }
 openLegacyDialog(d, body)
 assert.equal(d.open, true)
 d.close()
 assert.equal(d.open, false)
 assert.equal(closed, 1)
 assert.equal(bodyClasses.has('legacy-dialog-open'), false)
 assert.doesNotThrow(() => openLegacyDialog(d, body))
 assert.equal(d.open, true)
 d.close()
 assert.equal(closed, 2)
 assert.equal(dialogClasses.has('legacy-dialog'), true)
})
