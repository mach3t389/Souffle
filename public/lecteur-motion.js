/* Animation ES5 : position fractionnaire, défilement manuel natif à la pause. */
(function (root) {
 'use strict';
 function create(viewport, text) {
  var shift=0, position=0, previous=null;
  function maximum() { return Math.max(0,viewport.scrollHeight-viewport.clientHeight); }
  function bounded(value) { return Math.max(0,Math.min(maximum(),value)); }
  function read() { return bounded(viewport.scrollTop-shift); }
  function render(value, rebase) {
   var max=maximum();position=Math.max(0,Math.min(max,value));
   // Garder le défilement natif fixe entre les recalages évite les pas de pixels.
   if(rebase || Math.abs(viewport.scrollTop-position)>=64 || position===0 || position===max)viewport.scrollTop=position;
   shift=viewport.scrollTop-position;
   text.style.transform='translate3d(0,'+shift+'px,0)';
   return position>=max;
  }
  return {
   start:function(){previous=null;position=read();text.style.willChange='transform';},
   advance:function(now,speed){
    var elapsed=previous===null?0:Math.max(0,Math.min(now-previous,100));previous=now;
    return render(position+speed*elapsed/1000,false);
   },
   stop:function(){previous=null;render(read(),true);text.style.willChange='';},
   jump:function(value){previous=null;render(value,true);},
   position:read
  };
 }
 if(typeof module!=='undefined' && module.exports)module.exports=create;
 else root.SouffleReaderMotion=create;
}(this));
