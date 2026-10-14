import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pasteScale, pastedSize } from '../src/paste.ts'

test('pasted body text is made readable without flattening a larger heading', () => {
 const scale = pasteScale([
  { size: 12, weight: 120, heading: false },
  { size: 24, weight: 18, heading: true },
 ])
 assert.equal(pastedSize(12, scale), 18)
 assert.equal(pastedSize(24, scale), 36)
 assert.equal(pastedSize(10, scale), 18)
})

test('an already readable body is not reduced and extreme headings are limited', () => {
 const scale = pasteScale([{ size: 22, weight: 100, heading: false }])
 assert.equal(scale, 1)
 assert.equal(pastedSize(22, scale), 22)
 assert.equal(pastedSize(80, scale), 48)
})
