/* Garde chaque mot entier, même lorsque sa mise en forme traverse plusieurs éléments. ES5 pour Safari iOS 12. */
var SouffleReaderWords = (function () {
 'use strict';
 var blocks = 'p,h1,h2,h3,h4,h5,h6,li';
 function protect(container) {
  var elements = container.querySelectorAll(blocks);
  for (var i = 0; i < elements.length; i++) {
   var block = elements[i], text = '', parts = [];
   function collect(node) {
    if (node.nodeType === 3) {
     var value = node.nodeValue || '';
     parts.push({node:node,start:text.length,end:text.length+value.length});
     text += value;
     return;
    }
    if (node.nodeType !== 1) return;
    if (node !== block && (node.tagName === 'BR' || /^(P|H[1-6]|LI)$/.test(node.tagName))) { text += ' '; return; }
    for (var child = node.firstChild; child; child = child.nextSibling) collect(child);
   }
   collect(block);
   var words = [], match, expression = /\S+/g;
   while ((match = expression.exec(text))) words.push({start:match.index,end:match.index+match[0].length});
   function point(index, end) {
    for (var j = 0; j < parts.length; j++) {
     if (end ? parts[j].start < index && index <= parts[j].end : parts[j].start <= index && index < parts[j].end)
      return {node:parts[j].node,offset:index-parts[j].start};
    }
    return null;
   }
   for (var w = words.length-1; w >= 0; w--) {
    var first = point(words[w].start,false), last = point(words[w].end,true);
    if (!first || !last) continue;
    var range = document.createRange(), wrapper = document.createElement('span');
    wrapper.className = 'reader-word';
    range.setStart(first.node,first.offset);
    range.setEnd(last.node,last.offset);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
   }
  }
  update(container);
 }
 function update(container) {
  var words = container.querySelectorAll('.reader-word');
  for (var i = 0; i < words.length; i++) words[i].className = 'reader-word';
  var style = window.getComputedStyle(container);
  var width = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  if (width <= 0) return;
  for (var j = 0; j < words.length; j++) {
   if (words[j].getBoundingClientRect().width > width + 1) words[j].className = 'reader-word reader-word-long';
  }
 }
 return {protect:protect,update:update};
}());
