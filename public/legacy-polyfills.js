/* Small runtime shims for Safari on iOS 12. Loaded before the application bundle. */
(function () {
 'use strict';
 if (!Object.fromEntries) Object.fromEntries = function (pairs) {
  var result = {};
  Array.from(pairs).forEach(function (pair) { result[pair[0]] = pair[1]; });
  return result;
 };
 if (!Object.hasOwn) Object.hasOwn = function (object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
 };
 if (!Array.prototype.flatMap) Array.prototype.flatMap = function (callback, context) {
  var result = [];
  for (var i = 0; i < this.length; i++) if (i in this) {
   var item = callback.call(context, this[i], i, this);
   if (Array.isArray(item)) result.push.apply(result, item);
   else result.push(item);
  }
  return result;
 };
 if (!Array.prototype.flat) Array.prototype.flat = function (depth) {
  var result = [], max = depth === undefined ? 1 : Number(depth);
  function append(items, level) {
   for (var i = 0; i < items.length; i++) if (i in items) {
    if (Array.isArray(items[i]) && level < max) append(items[i], level + 1);
    else result.push(items[i]);
   }
  }
  append(this, 0);
  return result;
 };
 if (!Array.prototype.at) Array.prototype.at = function (index) {
  var position = Math.trunc(Number(index) || 0);
  return this[position < 0 ? this.length + position : position];
 };
 if (!Array.prototype.findLast) Array.prototype.findLast = function (callback, context) {
  for (var i = this.length - 1; i >= 0; i--) if (callback.call(context, this[i], i, this)) return this[i];
 };
 if (!Array.prototype.findLastIndex) Array.prototype.findLastIndex = function (callback, context) {
  for (var i = this.length - 1; i >= 0; i--) if (callback.call(context, this[i], i, this)) return i;
  return -1;
 };
 if (!Math.trunc) Math.trunc = function (value) { return value < 0 ? Math.ceil(value) : Math.floor(value); };
 if (!window.queueMicrotask) window.queueMicrotask = function (callback) { Promise.resolve().then(callback); };
}());
