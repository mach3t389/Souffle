import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../public/lecteur-gestures.js',import.meta.url),'utf8');
function setup(active=false){
 let time=1000,plays=0,selected=false;
 const listeners={},viewport={scrollTop:0,addEventListener:(type,handler)=>listeners[type]=handler};
 const context={module:{exports:{}},Date:{now:()=>time}};
 runInNewContext(source,context);
 context.module.exports(viewport,{isActive:()=>active,pause:()=>active=false,play:()=>{plays++;active=true;},hasSelection:()=>selected});
 const point=(x=30,y=40)=>({clientX:x,clientY:y,identifier:1});
 const send=(type,event={})=>listeners[type](event);
 return {viewport,send,point,advance:ms=>time+=ms,select:()=>selected=true,get active(){return active;},get plays(){return plays;},
 tap(){send('touchstart',{touches:[point()]});send('touchend',{touches:[],changedTouches:[point()]});},
 click(){send('mousedown',{button:0,...point()});send('click',{button:0,...point()});}};
}
test('un toucher reprend, puis le toucher suivant met en pause',()=>{
 const s=setup();s.tap();assert.equal(s.active,true);assert.equal(s.plays,1);
 s.advance(100);s.tap();assert.equal(s.active,false);assert.equal(s.plays,1);
});
test('le clic synthétique après un toucher ne bascule pas une seconde fois',()=>{
 const s=setup();s.tap();s.click();assert.equal(s.active,true);assert.equal(s.plays,1);
 s.advance(900);s.click();assert.equal(s.active,false);
});
test('un balayage met en pause et ne reprend pas au relâchement',()=>{
 const s=setup(true);s.send('touchstart',{touches:[s.point()]});assert.equal(s.active,false);
 s.send('touchmove',{touches:[s.point(30,100)]});s.viewport.scrollTop=200;
 s.send('touchend',{touches:[],changedTouches:[s.point(30,100)]});assert.equal(s.plays,0);
});
test('un déplacement revenu au point de départ reste un balayage',()=>{
 const s=setup();s.send('touchstart',{touches:[s.point()]});s.send('touchmove',{touches:[s.point(80,40)]});
 s.send('touchend',{touches:[],changedTouches:[s.point()]});assert.equal(s.plays,0);
});
test('un geste annulé, prolongé ou à plusieurs doigts ne lance pas la lecture',()=>{
 const s=setup();s.send('touchstart',{touches:[s.point()]});s.send('touchcancel');
 s.send('touchend',{touches:[],changedTouches:[s.point()]});assert.equal(s.plays,0);
 s.send('touchstart',{touches:[s.point()]});s.advance(600);s.send('touchend',{touches:[],changedTouches:[s.point()]});assert.equal(s.plays,0);
 s.send('touchstart',{touches:[s.point(),{...s.point(),identifier:2}]});s.send('touchend',{touches:[],changedTouches:[s.point()]});assert.equal(s.plays,0);
});
test('le défilement, la sélection et le glisser souris ne déclenchent pas de reprise',()=>{
 const s=setup();s.send('touchstart',{touches:[s.point()]});s.viewport.scrollTop=20;
 s.send('touchend',{touches:[],changedTouches:[s.point()]});assert.equal(s.plays,0);
 s.advance(900);s.send('mousedown',{button:0,...s.point()});s.send('mousemove',s.point(90,40));s.send('click',{button:0,...s.point(90,40)});assert.equal(s.plays,0);
 s.select();s.click();assert.equal(s.plays,0);
});
test('la molette met en pause et un clic simple reprend depuis cette position',()=>{
 const s=setup(true);s.send('wheel');s.viewport.scrollTop=300;assert.equal(s.active,false);
 s.click();assert.equal(s.active,true);assert.equal(s.viewport.scrollTop,300);
});
