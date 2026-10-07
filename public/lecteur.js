/* Lecteur autonome : syntaxe ES5, sans éditeur ni dépendance réseau. */
(function () {
 'use strict';
 var packet = {}, settings = { size:54, speed:35, countdown:3, mirrorX:false, mirrorY:false, proportional:true, font:'sans-serif' };
 var playing = false, remaining = 0, timer = 0, frame = 0, immersive = false, testingSpeed = false;
 function el(id) { return document.getElementById(id); }
 function clamp(value, min, max, fallback) { value = Number(value); return isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
 try { packet = JSON.parse(localStorage.getItem('souffle.reader.v1') || '{}'); var stored = packet.settings || {}; Object.keys(settings).forEach(function (k) { if (typeof stored[k] === typeof settings[k]) settings[k] = stored[k]; }); } catch (e) { packet = {}; }
 settings.size = Math.round(clamp(settings.size,28,100,54)); settings.speed = Math.round(clamp(settings.speed,5,120,35)); if ([0,3,5,10].indexOf(settings.countdown) < 0) settings.countdown = 3;
 function clean(html) {
  var source = document.createElement('div'), target = document.createElement('div'); source.innerHTML = html;
  function visit(node, parent) {
   if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent)); return; }
   if (node.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|IMG|VIDEO|AUDIO|LINK|META)$/.test(node.tagName)) return;
   var allowed = /^(P|H1|H2|H3|H4|H5|H6|STRONG|B|EM|I|U|S|SPAN|BR|UL|OL|LI|BLOCKQUOTE)$/.test(node.tagName);
   var copy = allowed ? document.createElement(node.tagName.toLowerCase()) : parent;
   if (allowed) { if(node.getAttribute('data-id'))copy.setAttribute('data-id',node.getAttribute('data-id')); var size = node.style.fontSize; if (/^[0-9.]+(px|pt|em|rem|%)$/.test(size)) copy.setAttribute('data-size', size); var family = node.style.fontFamily; if (family) copy.setAttribute('data-font', family); if (/^(left|right|center|justify)$/.test(node.style.textAlign)) copy.style.textAlign = node.style.textAlign; parent.appendChild(copy); }
   var children = node.childNodes; for (var i=0;i<children.length;i++) visit(children[i], copy);
  }
  var children = source.childNodes; for (var i=0;i<children.length;i++) visit(children[i],target); return target;
 }
 var content = clean(typeof packet.html === 'string' ? packet.html : '<h1>Un peu de souffle.</h1><p>Voici le lecteur léger pour les essais sur iPad. Le contrôle à distance n’est pas encore connecté.</p><p>Sur ton ordinateur, ouvre un script dans l’éditeur, puis choisis « Ouvrir le téléprompteur ».</p><h2>Trouve ton rythme</h2><p>Essaie la vitesse, la taille, le décompte et les miroirs. Le texte défile directement sur cet appareil.</p>');
 while(content.firstChild) el('text').appendChild(content.firstChild);
 el('title').textContent = packet.title || 'Lecture d’essai';
 var motion=SouffleReaderMotion(el('viewport'),el('text'));
 function save() { if(remote)return;try { packet.settings = settings; localStorage.setItem('souffle.reader.v1',JSON.stringify(packet)); var key=packet.workspaceKey||'souffle.workspace.v1';var workspace = JSON.parse(localStorage.getItem(key) || 'null'); if (workspace) { if(workspace.workspace){workspace.workspace.settings=settings;workspace.dirty=true;}else workspace.settings = settings; localStorage.setItem(key,JSON.stringify(workspace)); } } catch (e) { el('title').textContent = 'Lecture — réglages non sauvegardés'; } }
 function sizeInEm(size) { var n = parseFloat(size); if (/px$/.test(size)) return n/18; if (/pt$/.test(size)) return n/13.5; if (/%$/.test(size)) return n/100; return n; }
 function style() { var text = el('text'); text.style.fontSize = settings.size+'px'; text.style.fontFamily = settings.font === 'original' ? 'sans-serif' : settings.font; text.className = settings.proportional ? '' : 'uniform'; var spans = text.querySelectorAll('[data-size],[data-font]'); for(var i=0;i<spans.length;i++){ var s=spans[i]; s.style.fontFamily = settings.font === 'original' ? (s.getAttribute('data-font') || '') : settings.font; s.style.fontSize = s.hasAttribute('data-size') && settings.proportional ? clamp(sizeInEm(s.getAttribute('data-size')), .3, 8, 1)+'em' : ''; } el('viewport').style.transform = 'scale('+(settings.mirrorX?-1:1)+','+(settings.mirrorY?-1:1)+')'; el('mirror-x').setAttribute('aria-pressed',String(settings.mirrorX)); el('mirror-y').setAttribute('aria-pressed',String(settings.mirrorY)); }
 function playbackUI() {
  el('play').textContent=playing&&!testingSpeed?'Ⅱ Pause':remaining?'Ⅱ Annuler':'▷ Lire';
  el('test-speed-label').textContent=testingSpeed?'Arrêter':'Tester';
  el('test-speed').setAttribute('aria-label',testingSpeed?'Arrêter l’essai de vitesse':'Tester la vitesse');
  el('test-speed').setAttribute('aria-pressed',String(testingSpeed));
  el('test-speed').title=testingSpeed?'Arrêter l’essai de vitesse':'Tester la vitesse sans décompte';
  var label=playing?'Mettre en pause':remaining?'Annuler le décompte':'Reprendre la lecture';
  el('immersive-play').setAttribute('aria-label',label);el('immersive-play').title=label;
  el('mini-play-icon').style.display=!playing&&!remaining?'':'none';
  el('mini-pause-icon').style.display=playing?'':'none';
  el('mini-cancel-icon').style.display=remaining?'':'none';
 }
 function setImmersive(active) { var point=settings.mirrorY?null:anchor();immersive=active;document.body.className=active?'immersive':'';el('reader-header').hidden=active;el('reader-settings').hidden=active;el('reader-minibar').hidden=!active;el('hide-settings').setAttribute('aria-expanded',String(!active));el('show-settings').setAttribute('aria-expanded',String(!active));if(active)el('immersive-play').focus();if(point){var after=point.node.getBoundingClientRect().top-el('viewport').getBoundingClientRect().top;el('viewport').scrollTop+=after-point.offset;} }
 function showSettings() { pause();setImmersive(false);el('play').focus(); }
 function pause() { testingSpeed=false;playing=false; remaining=0; cancelAnimationFrame(frame); clearInterval(timer);motion.stop(); el('countdown').textContent=''; playbackUI(); }
 function tick(now) { if(!playing)return;if(motion.advance(now,settings.speed)){pause();return;}frame=requestAnimationFrame(tick); }
 function begin() { motion.start();playing=true;playbackUI();frame=requestAnimationFrame(tick); }
 function play() { if(el('play').disabled)return;if(testingSpeed)pause();else if(playing||remaining){pause();return;}if(!immersive)setImmersive(true);remaining=settings.countdown;if(!remaining){begin();return;}playbackUI();el('countdown').textContent=String(remaining);timer=setInterval(function(){remaining--;el('countdown').textContent=remaining?String(remaining):'';if(!remaining){clearInterval(timer);begin();}},1000); }
 function testSpeed() { if(el('play').disabled)return;var stop=testingSpeed;pause();if(stop)return;if(immersive)setImmersive(false);testingSpeed=true;begin(); }
 function anchor() { var viewport=el('viewport'), rect=viewport.getBoundingClientRect(), elements=el('text').querySelectorAll('p,h1,h2,h3,li'); for(var i=0;i<elements.length;i++){var r=elements[i].getBoundingClientRect();if(r.bottom>rect.top+viewport.clientHeight*.25)return {node:elements[i],offset:r.top-rect.top};}return null; }
 function restyle() { pause();var point=settings.mirrorY?null:anchor();style();if(point){var after=point.node.getBoundingClientRect().top-el('viewport').getBoundingClientRect().top;el('viewport').scrollTop+=after-point.offset;}save(); }
 function speedUI() { el('speed').value=settings.speed;el('speed-number').value=settings.speed;el('speed-minus').disabled=settings.speed<=5;el('speed-plus').disabled=settings.speed>=120; }
 function setSpeed(value) { settings.speed=Math.round(clamp(value,5,120,settings.speed));speedUI();save(); }
 function sizeUI() { el('size-number').value=settings.size;el('size-minus').disabled=settings.size<=28;el('size-plus').disabled=settings.size>=100; }
 function setSize(value) { settings.size=Math.round(clamp(value,28,100,settings.size));sizeUI();restyle(); }
 function commitSize() { setSize(this.value.trim()===''?settings.size:this.value); }
 function commitSpeed() { setSpeed(this.value.trim()===''?settings.speed:this.value); }
 speedUI();sizeUI();el('delay').value=settings.countdown;el('font').value=settings.font;el('proportional').checked=settings.proportional;
 el('speed-minus').onclick=function(){setSpeed(settings.speed-1);};el('speed-plus').onclick=function(){setSpeed(settings.speed+1);};el('speed-number').onchange=commitSpeed;el('speed-number').onblur=commitSpeed;el('speed-number').onkeydown=function(e){if(e.key==='Enter'){commitSpeed.call(this);this.blur();}};
 el('test-speed').onclick=testSpeed;el('reader-exit').onclick=function(){pause();};el('play').onclick=function(){play();};el('immersive-play').onclick=function(){play();};el('show-settings').onclick=showSettings;el('hide-settings').onclick=function(){if(testingSpeed)pause();setImmersive(true);};el('size-minus').onclick=function(){setSize(settings.size-1);};el('size-plus').onclick=function(){setSize(settings.size+1);};el('size-number').onchange=commitSize;el('size-number').onblur=commitSize;el('size-number').onkeydown=function(e){if(e.key==='Enter'){commitSize.call(this);this.blur();}};el('restart').onclick=function(){pause();motion.jump(0);};el('speed').oninput=function(){setSpeed(this.value);};el('delay').onchange=function(){pause();settings.countdown=Number(this.value);save();};el('font').onchange=function(){settings.font=this.value;restyle();};el('proportional').onchange=function(){settings.proportional=this.checked;restyle();};el('mirror-x').onclick=function(){settings.mirrorX=!settings.mirrorX;style();save();};el('mirror-y').onclick=function(){settings.mirrorY=!settings.mirrorY;style();save();};
 SouffleReaderGestures(el('viewport'),{isActive:function(){return playing||remaining>0;},pause:pause,play:play,hasSelection:function(){var selection=window.getSelection();return !!selection&&!selection.isCollapsed;}});document.addEventListener('visibilitychange',function(){if(document.hidden){pause();needsReconnect=true;}});document.addEventListener('keydown',function(e){if(/INPUT|SELECT/.test(e.target.tagName))return;if((e.code==='Space'||e.key===' ')&&!/BUTTON|A/.test(e.target.tagName)){e.preventDefault();if(testingSpeed)pause();else play();}if(e.key==='Escape'){if(immersive)showSettings();else window.location.href='/';}});style();
 // Lien d'association dans le fragment : le jeton n'est pas envoyé à l'hébergeur.
 var remote=null,sequence=-1,loaded=false,needsReconnect=false;
 try { var params=new URLSearchParams(location.hash.slice(1));if(params.get('token')){
  var server=params.get('server')||'',key=params.get('key')||'',token=params.get('token')||'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(server)||!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid session');
  remote={server:server,key:key,token:token};el('title').textContent='Connexion à la session…';el('text').innerHTML='';el('play').disabled=true;el('immersive-play').disabled=true;el('test-speed').disabled=true;
  var badge=document.querySelector('.badge');if(badge)badge.textContent='LECTEUR · DISTANT';
  history.replaceState(null,'',location.pathname+location.hash);
 }}catch(e){el('title').textContent='Lien de session invalide';}
 function loadSnapshot(s){pause();while(el('text').firstChild)el('text').removeChild(el('text').firstChild);var safe=clean(s.html||'');while(safe.firstChild)el('text').appendChild(safe.firstChild);packet.title=s.title;el('title').textContent=s.title||'Lecture distante';applySettings(s.settings||{});motion.jump(0);el('play').disabled=false;el('immersive-play').disabled=false;el('test-speed').disabled=false;}
 function applySettings(s){Object.keys(settings).forEach(function(k){if(typeof s[k]===typeof settings[k])settings[k]=s[k];});settings.speed=Math.round(clamp(settings.speed,5,120,35));settings.size=Math.round(clamp(settings.size,28,100,54));settings.countdown=[0,3,5,10].indexOf(settings.countdown)>=0?settings.countdown:3;speedUI();sizeUI();el('delay').value=settings.countdown;el('font').value=settings.font;el('proportional').checked=settings.proportional;style();}
 function seek(id){pause();if(!id){motion.jump(0);return;}var nodes=el('text').querySelectorAll('[data-id]');for(var i=0;i<nodes.length;i++)if(nodes[i].getAttribute('data-id')===id){var rect=nodes[i].getBoundingClientRect(),v=el('viewport').getBoundingClientRect();el('viewport').scrollTop+=settings.mirrorY?v.bottom-rect.bottom-el('viewport').clientHeight*.25:rect.top-v.top-el('viewport').clientHeight*.25;return;}}
 function poll(){if(!remote)return;if(document.hidden){setTimeout(poll,1500);return;}var xhr=new XMLHttpRequest();xhr.open('POST',remote.server+'/rest/v1/rpc/poll_reading_session');xhr.setRequestHeader('apikey',remote.key);xhr.setRequestHeader('Content-Type','application/json');xhr.timeout=8000;
  xhr.onload=function(){if(xhr.status<200||xhr.status>=300){needsReconnect=true;el('title').textContent=xhr.status===400?'Session expirée ou terminée':'Connexion interrompue · lecture locale';if(xhr.status===400){remote=null;return;}setTimeout(poll,2000);return;}try{var state=JSON.parse(xhr.responseText);var first=!loaded;if(first){loadSnapshot(state.snapshot);loaded=true;}el('title').textContent=packet.title||'Lecture distante';if(needsReconnect||first){pause();sequence=state.sequence;needsReconnect=false;}else if(state.sequence>sequence){var command=state.command||{};if(command.action==='reload'&&state.snapshot){var point=anchor();var block=point?point.node.getAttribute('data-id'):'';loadSnapshot(state.snapshot);seek(block);}else if(command.action==='pause')pause();else if(command.action==='seek')seek(command.blockId);else if(command.action==='play'){seek(command.blockId);settings.countdown=clamp(command.countdown,0,10,3);setSpeed(command.speed);play();}else if(command.action==='speed')setSpeed(command.speed);else if(command.action==='settings'){pause();applySettings(command.settings||{});}sequence=state.sequence;}}catch(e){el('title').textContent='Commande invalide · lecture en pause';pause();}setTimeout(poll,750);};
  xhr.onerror=xhr.ontimeout=function(){needsReconnect=true;el('title').textContent='Connexion interrompue · lecture locale';setTimeout(poll,2000);};xhr.send(JSON.stringify({access_token:remote.token,ack:sequence,reader_state:playing?'playing':remaining?'countdown':'paused',include_snapshot:!loaded}));
 }
 if(remote)poll();else if(typeof packet.startBlockId==='string')seek(packet.startBlockId);
}());

