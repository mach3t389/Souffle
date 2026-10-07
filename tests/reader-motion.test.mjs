import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../public/lecteur-motion.js',import.meta.url),'utf8');
function setup({top=0,max=1000,quantum=1,nativeMax=max}={}){
 let nativeTop=top;
 const writes=[],text={style:{}},viewport={clientHeight:400,scrollHeight:max+400};
 Object.defineProperty(viewport,'scrollTop',{get:()=>nativeTop,set:value=>{nativeTop=Math.min(nativeMax,Math.max(0,Math.round(value/quantum)*quantum));writes.push(nativeTop);}});
 const context={module:{exports:{}}};runInNewContext(source,context);
 const motion=context.module.exports(viewport,text);
 return {motion,viewport,text,writes,visual:()=>viewport.scrollTop-Number(text.style.transform?.match(/translate3d\(0,([^p]+)px,0\)/)?.[1]||0)};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
test('5 px/s avance à chaque image même si le navigateur arrondit le scroll natif',()=>{
 const s=setup();s.motion.start();s.motion.advance(0,5);
 let before=s.visual();
 for(let i=1;i<=60;i++){s.motion.advance(i*1000/60,5);near(s.visual()-before,5/60);before=s.visual();}
 near(s.visual(),5);assert.ok(s.writes.length<=2,'pas de défilement natif à chaque image');
});
test('les recalages périodiques conservent la position visuelle fractionnaire',()=>{
 const s=setup({quantum:.8});s.motion.start();s.motion.advance(0,120);
 for(let i=1;i<=180;i++){s.motion.advance(i*1000/60,120);near(s.visual(),i*2);}
 near(s.motion.position(),360);assert.ok(s.writes.length<15);
});
test('pause et reprise ne perdent pas la fraction de pixel',()=>{
 const s=setup({top:150});s.motion.start();s.motion.advance(0,5);s.motion.advance(50,5);
 near(s.visual(),150.25);s.motion.stop();near(s.visual(),150.25);
 s.motion.start();s.motion.advance(5000,5);near(s.visual(),150.25);
 s.motion.advance(5050,5);near(s.visual(),150.5);
});
test('après un défilement manuel, la reprise utilise la position affichée',()=>{
 const s=setup();s.motion.start();s.motion.advance(0,5);s.motion.advance(50,5);s.motion.stop();
 s.viewport.scrollTop=310;const displayed=s.visual();s.motion.start();s.motion.advance(9000,5);near(s.visual(),displayed);
 s.motion.advance(9050,5);near(s.visual(),displayed+.25);
});
test('la fin arrête sur place; relancer ne revient jamais au début',()=>{
 const s=setup({top:999.75});s.motion.start();s.motion.advance(0,5);
 assert.equal(s.motion.advance(100,5),true);near(s.visual(),1000);s.motion.stop();
 s.motion.start();assert.equal(s.motion.advance(10000,5),true);near(s.visual(),1000);
 assert.ok(!s.writes.includes(0));
 s.motion.stop();s.viewport.scrollTop=700;s.motion.start();assert.equal(s.motion.advance(12000,5),false);near(s.visual(),700);
});
test('seul un retour au début explicite remet la position à zéro',()=>{
 const s=setup({top:200});s.motion.start();s.motion.advance(0,5);s.motion.advance(50,5);s.motion.stop();
 s.motion.jump(0);near(s.visual(),0);near(s.motion.position(),0);
});
test('une image retardée ou une horloge reculée ne provoque pas de grand saut',()=>{
 const s=setup();s.motion.start();s.motion.advance(0,5);s.motion.advance(3000,5);near(s.visual(),.5);
 s.motion.advance(2990,5);near(s.visual(),.5);
});

test('la fin reste stable lorsque les dimensions entières diffèrent du scroll natif',()=>{
 const s=setup({top:999.2,max:1000,nativeMax:999.2,quantum:.8});s.motion.start();s.motion.advance(0,5);
 for(let i=1;i<=3;i++)s.motion.advance(i*100,5);
 near(s.visual(),1000);s.motion.stop();near(s.visual(),1000);
 s.motion.start();assert.equal(s.motion.advance(10000,5),true);near(s.visual(),1000);
});
test('un document sans défilement s’arrête immédiatement sur place',()=>{
 const s=setup({max:0});s.motion.start();assert.equal(s.motion.advance(0,5),true);near(s.visual(),0);
});
