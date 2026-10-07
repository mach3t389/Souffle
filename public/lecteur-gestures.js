/* Gestes compatibles avec le lecteur ES5 et les anciens écrans tactiles. */
(function (root) {
 'use strict';
 function attach(viewport, controls) {
  var touch = null, mouse = null, ignoreMouseUntil = 0;
  function start(x, y) {
   var gesture = { x:x, y:y, scroll:viewport.scrollTop, time:Date.now(), active:controls.isActive(), moved:false };
   controls.pause();
   return gesture;
  }
  function move(gesture, x, y) {
   if (gesture && (Math.abs(x-gesture.x)>10 || Math.abs(y-gesture.y)>10)) gesture.moved=true;
  }
  function finish(gesture) {
   if (!gesture || gesture.moved || Date.now()-gesture.time>500 || Math.abs(viewport.scrollTop-gesture.scroll)>4) return;
   if (controls.hasSelection()) return;
   if (gesture.active) controls.pause(); else controls.play();
  }
  viewport.addEventListener('touchstart',function(e){
   ignoreMouseUntil=Date.now()+800;
   mouse=null;
   if(e.touches.length!==1){touch=null;controls.pause();return;}
   var p=e.touches[0];
   touch=start(p.clientX,p.clientY);touch.id=p.identifier;
  },{passive:true});
  viewport.addEventListener('touchmove',function(e){
   if(!touch)return;
   if(e.touches.length!==1){touch=null;return;}
   var p=e.touches[0];
   if(p.identifier!==touch.id){touch=null;return;}
   move(touch,p.clientX,p.clientY);
  },{passive:true});
  viewport.addEventListener('touchend',function(e){
   ignoreMouseUntil=Date.now()+800;
   var gesture=touch;touch=null;
   if(!gesture || e.touches.length)return;
   var p=e.changedTouches[0];
   if(!p || p.identifier!==gesture.id)return;
   move(gesture,p.clientX,p.clientY);finish(gesture);
  },{passive:true});
  viewport.addEventListener('touchcancel',function(){touch=null;ignoreMouseUntil=Date.now()+800;},{passive:true});
  viewport.addEventListener('mousedown',function(e){
   if(e.button!==0 || Date.now()<ignoreMouseUntil)return;
   mouse=start(e.clientX,e.clientY);
  });
  viewport.addEventListener('mousemove',function(e){move(mouse,e.clientX,e.clientY);});
  viewport.addEventListener('mouseleave',function(){mouse=null;});
  viewport.addEventListener('click',function(e){
   var gesture=mouse;mouse=null;
   if(Date.now()<ignoreMouseUntil || e.button!==0)return;
   move(gesture,e.clientX,e.clientY);finish(gesture);
  });
  viewport.addEventListener('wheel',function(){mouse=null;touch=null;controls.pause();},{passive:true});
 }
 if(typeof module!=='undefined' && module.exports)module.exports=attach;
 else root.SouffleReaderGestures=attach;
}(this));
