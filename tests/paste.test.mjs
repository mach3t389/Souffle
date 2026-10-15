import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pasteScale, pastedSize, readableDocument } from '../src/paste.ts'

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

test('older Word text is readable in the editor without mutating its stored document', () => {
 const original = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Word 12', marks: [{ type: 'textStyle', attrs: { fontSize: '12pt', color: '#222' } }] },
  { type: 'text', text: ' Grand', marks: [{ type: 'textStyle', attrs: { fontSize: '24px' } }] },
 ] }] }
 const readable = readableDocument(original)
 assert.equal(readable.content[0].content[0].marks[0].attrs.fontSize, '18px')
 assert.equal(readable.content[0].content[0].marks[0].attrs.color, '#222')
 assert.equal(readable.content[0].content[1].marks[0].attrs.fontSize, '24px')
 assert.equal(original.content[0].content[0].marks[0].attrs.fontSize, '12pt')
})
