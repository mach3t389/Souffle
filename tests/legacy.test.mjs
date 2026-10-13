import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

test('the iOS 12 shims run before the application module', () => {
 const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
 assert.ok(html.indexOf('/legacy-polyfills.js') < html.indexOf('/src/main.ts'))
 const source = readFileSync(new URL('../public/legacy-polyfills.js', import.meta.url), 'utf8')
 const result = runInNewContext(`
  Object.fromEntries = undefined;
  Object.hasOwn = undefined;
  Array.prototype.flatMap = undefined;
  Array.prototype.flat = undefined;
  Array.prototype.at = undefined;
  Array.prototype.findLast = undefined;
  Array.prototype.findLastIndex = undefined;
  var window = {};
  ${source}
  ({ entries: Object.fromEntries([['a', 1]]).a,
     own: Object.hasOwn({a: 1}, 'a'),
     mapped: [1, 2].flatMap(function (x) { return [x, x]; }).join(','),
     flattened: [1, [2, [3]]].flat(2).join(','),
     last: [1, 2].at(-1),
     found: [1, 2].findLast(function (x) { return x < 2; }),
     index: [1, 2].findLastIndex(function (x) { return x < 2; }),
     microtask: typeof window.queueMicrotask })
 `)
 assert.deepEqual(JSON.parse(JSON.stringify(result)), {
  entries: 1, own: true, mapped: '1,1,2,2', flattened: '1,2,3',
  last: 2, found: 1, index: 0, microtask: 'function',
 })
})
