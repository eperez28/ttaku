(()=>{
 const VERSION=chrome.runtime.getManifest().version;if(globalThis.__takuVersion===VERSION)return;globalThis.__takuVersion=VERSION;
 const GEN=(globalThis.__takuGen=(globalThis.__takuGen||0)+1);
 let active=false,video=null,host=null,shadow=null,phase='off',cardAnchor='bottom',phrase=null,segmentStart=0,segmentEnd=0,replayEnd=0,guard=null,previousRate=1,phraseURL='',cueKey='',captionNode=null,observer=null,wordEls=[],lastFont='',noticeTimer=null,lastNotice='',lastNoticeAt=0;
 const $=id=>shadow?.getElementById(id);
 const send=event=>chrome.runtime.sendMessage({target:'worker',type:'player-event',event}).catch(()=>{});
 const pauseAll=()=>{for(const v of document.querySelectorAll('video')){if(!v.paused)v.pause()}};
 const findVideo=()=>[...document.querySelectorAll('video')].filter(v=>v.getBoundingClientRect().width>100).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
 const captionSelector='.bmpui-ui-subtitle-label,.bmpui-subtitle-region-container,.shaka-text-container,[data-testid="subtitle"],[data-testid="subtitles"],.vjs-text-track-display';
 function position(){
  if(!host||!video)return;
  const r=video.getBoundingClientRect(),width=r.width||video.clientWidth,height=r.height||video.clientHeight;
  const node=[...document.querySelectorAll(captionSelector)].find(e=>e.textContent.trim()&&e.getBoundingClientRect().height>0);
  if(node){captionNode=node;const style=getComputedStyle(node);if(style.fontFamily&&style.fontFamily!==lastFont){host.style.setProperty('--caption-font',style.fontFamily);lastFont=style.fontFamily}if(style.fontWeight)host.style.setProperty('--caption-weight',style.fontWeight);if(style.textShadow&&style.textShadow!=='none')host.style.setProperty('--caption-shadow',style.textShadow)}
  const captionTop=node?.getBoundingClientRect().top;
  const bottom=Number.isFinite(captionTop)?Math.max(28,innerHeight-captionTop+12):Math.max(28,innerHeight-(r.bottom||height)+height*.18);
  const card=$('card');card.style.left=((r.left||0)+width/2)+'px';
  // Practice lines sit at the top of the video; idle states keep
  // the subtitle position.
  if(cardAnchor==='top'){card.style.top=((r.top||0)+Math.max(44,height*.09))+'px';card.style.bottom='auto'}
  else{card.style.top='auto';card.style.bottom=bottom+'px'}
  card.style.maxWidth=Math.max(200,width*.9)+'px';
  let size=Math.min(32,Math.max(17,height*.034));$('romaji').style.fontSize=size+'px';
  const measured=$('romaji').scrollWidth;if(measured>width*.87)$('romaji').style.fontSize=Math.max(16,size*(width*.87)/measured)+'px';
 }
 function mount(){
  for(const el of document.querySelectorAll('#taku-root'))if(el!==host)el.remove();
  if(!host){
   host=document.createElement('div');host.id='taku-root';shadow=host.attachShadow({mode:'open'});
   shadow.innerHTML=`<style>
   :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color:#fff!important;--caption-font:'Trebuchet MS',Arial,sans-serif;--caption-weight:700;--caption-shadow:1.5px 2px 2px #000}
   *{box-sizing:border-box}[hidden]{display:none!important}button{font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#fff;cursor:pointer}button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:1px solid white;outline-offset:3px}svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
   .caption{position:absolute;left:50%;bottom:18%;transform:translateX(-50%);width:max-content;max-width:90%;pointer-events:auto;text-align:center}
   .glass{position:relative;padding:2px 10px 4px}
   .glass::before{content:"";position:absolute;inset:-4px -10px;background:#0002;backdrop-filter:blur(7px);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);border-radius:12px;pointer-events:none}
   .line{position:relative;font:var(--caption-weight) 38px/1.3 var(--caption-font);display:flex;flex-wrap:wrap;justify-content:center;gap:.18em .24em}
   .word{position:relative;display:inline-block;white-space:pre}
   .outline{color:#fff;-webkit-text-stroke:.2em #000;paint-order:stroke fill;text-shadow:var(--caption-shadow)}
   .fill{position:absolute;inset:0 auto auto -3px;width:0;height:110%;overflow:hidden;transition:width 130ms ease-out;pointer-events:none}
   .ink{display:block;width:max-content;padding-left:3px;color:#ffd83d;-webkit-text-stroke:.2em #000;paint-order:stroke fill;text-shadow:var(--caption-shadow)}
   .word.done .fill{width:calc(100% + 8px)}
   .pending{color:#fff;text-shadow:var(--caption-shadow);font-size:.65em}
   .controls,.details,.status{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:min(82vw,420px)}
   .controls{bottom:100%;display:flex;align-items:center;gap:2px;background:#141414e8;backdrop-filter:blur(12px);border-radius:8px;padding:3px;opacity:0;pointer-events:none;transition:opacity .15s}
   .caption:hover .controls,.caption:focus-within .controls,.caption[data-phase=error] .controls,.caption[data-phase=empty] .controls,.caption[data-phase=listening] .controls,.caption[data-phase=retry] .controls,.caption[data-phase=checking] .controls{opacity:1;pointer-events:auto}
   .controls button,.end button{display:grid;place-items:center;min-width:34px;height:32px;background:none;border:0;border-radius:5px}
   .controls button:hover,.words button:hover{background:#ffffff20}
   .controls button.text{width:auto;padding:0 10px;font-size:12px;font-weight:600;white-space:nowrap}
   .details,.status{bottom:calc(100% + 43px);padding:9px 13px;border-radius:8px;background:#141414e8;backdrop-filter:blur(12px);font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#fff}
   .status:empty,.caption:has(.details:not([hidden])) .status{display:none}
   .words{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:7px}
   .words button{border:0;background:#ffffff12;border-radius:5px;font-size:12px;padding:5px 8px}
   .japanese{font-size:12px;color:#ddd;margin-top:4px}
   .end{position:absolute;top:18px;right:18px;pointer-events:auto;opacity:0;transition:opacity .15s}
   .end:hover,.end:focus-within{opacity:1}
   .end button{background:#141414e8}
   @media(prefers-reduced-motion:reduce){.fill,.controls{transition:none}}
   </style><div class="end"><button id="stop" aria-label="Stop Taku" title="Stop Taku"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><section class="caption" id="card" hidden role="region" aria-label="Repeat the Japanese line"><div class="controls"><button id="replay" class="text" aria-label="Replay line" title="Replay line">Replay</button><button id="retry" class="text" aria-label="Try again" title="Try again">Try again</button><button id="commit" class="text" aria-label="Done speaking" title="Done speaking">Done</button><button id="details-toggle" class="text" aria-label="Meaning and words" title="Meaning and words">Meaning</button><button id="skip" class="text" aria-label="Skip line" title="Skip line">Skip</button></div><div class="glass"><div class="line" id="romaji"></div></div><div class="status" id="feedback" role="status" aria-live="polite"></div><div class="details" id="details" hidden><div class="translation" id="meaning"></div><div class="japanese" id="japanese" hidden></div><div class="words" id="words"></div></div></section>`;
   $('details-toggle').onclick=()=>{$('details').hidden=!$('details').hidden};
   $('stop').onclick=()=>chrome.runtime.sendMessage({target:'worker',type:'stop'});
   $('skip').onclick=()=>send({type:'skip'});$('retry').onclick=()=>send({type:'retry'});$('commit').onclick=()=>send({type:'commit'});
   $('replay').onclick=()=>{previousRate=video.playbackRate;video.playbackRate=1;send({type:'replay'})};
   chrome.storage.local.get('showJapanese').then(({showJapanese})=>{if($('japanese'))$('japanese').hidden=!showJapanese}).catch(()=>{});
   for(const event of ['keydown','pointerdown','click'])host.addEventListener(event,e=>e.stopPropagation());
  }
  const fs=document.fullscreenElement,parent=fs&&fs.tagName!=='VIDEO'?fs:document.documentElement;if(host.parentNode!==parent)parent.append(host);position();
 }
 function renderWords(){
  $('words').replaceChildren();
  for(const word of phrase.words||[]){const b=document.createElement('button');b.textContent=word.romaji;b.title=word.meaning;b.onclick=async()=>{await chrome.runtime.sendMessage({target:'worker',type:'save',word,context:{sentence:phrase.japanese,romaji:phrase.romaji,meaning:phrase.meaning,title:document.title,url:phraseURL,time:segmentStart}});b.textContent='✓ '+word.romaji};$('words').append(b)}
 }
 function showWords(){
  wordEls=[];$('romaji').replaceChildren();
  const tokens=phrase.tokens?.length?phrase.tokens:phrase.romaji.split(/\s+/).filter(Boolean).map(romaji=>({romaji}));
  for(const token of tokens){const word=document.createElement('span');word.className='word';const outline=document.createElement('span');outline.className='outline';outline.textContent=token.romaji;const fill=document.createElement('span');fill.className='fill';fill.setAttribute('aria-hidden','true');const ink=document.createElement('span');ink.className='ink';ink.textContent=token.romaji;fill.append(ink);word.append(outline,fill);$('romaji').append(word);wordEls.push(word)}
  $('romaji').setAttribute('aria-label',phrase.romaji);position();
 }
 function progress(count){wordEls.forEach((word,i)=>word.classList.toggle('done',i<count))}
 function state(next,message=''){
  // A clip that was not confirmed as a Japanese line (or failed before any
  // line was shown) must never hold the video paused. But do not fail
  // silently either: flash why (e.g. a Meta error) without pausing.
  if((next==='empty'||next==='error')&&phase==='watching'&&!phrase){
   phase='watching';mount();$('card').dataset.phase='watching';
   if(next==='error'&&message&&!(message===lastNotice&&Date.now()-lastNoticeAt<30000)){
    lastNotice=message;lastNoticeAt=Date.now();$('card').hidden=false;$('feedback').textContent=message;
    clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{if(phase==='watching'){$('card').hidden=true;$('feedback').textContent=''}},5000);
   } else if(next==='empty'){$('card').hidden=true;$('feedback').textContent=''}
   return;
  }
  phase=next;mount();$('card').hidden=['watching','off'].includes(next);$('card').dataset.phase=next;
  $('feedback').textContent=['error','empty','retry'].includes(next)?message:'';
  if($('feedback').textContent)$('details').hidden=true;
  $('retry').hidden=!(next==='error'&&phrase);$('retry').disabled=!phrase;
  $('replay').disabled=!phrase||['processing','replay','passed'].includes(next);$('commit').disabled=next!=='listening';$('details-toggle').disabled=!phrase;
  if(next==='processing'){$('details').hidden=true;$('card').hidden=true;wordEls=[]}
  if(next==='watching'){phrase=null;cardAnchor='bottom';$('details').hidden=true;wordEls=[]}
 }
 function onPause(){if(active&&phase==='watching')send({type:'video-paused'})}
 function onPlay(){
  if(!active)return;
  if(phase==='watching'){send({type:'video-playing'});return}
  // The user pressed Play themselves: skip this line and keep watching.
  if(['listening','checking','retry','error','processing','passed'].includes(phase)){state('watching');send({type:'user-continue'})}
 }
 function checkCue(){
  if(!active||phase!=='watching')return;
  let key='';for(const track of video.textTracks||[]){if(track.mode==='showing'&&track.activeCues?.length){const cue=track.activeCues[0];key=cue.startTime+':'+cue.endTime+':'+cue.text;break}}
  if(!key&&captionNode?.isConnected)key=captionNode.textContent.trim();
  if(cueKey&&key!==cueKey)send({type:'caption-boundary'});cueKey=key;
 }
 function cleanup(){active=false;clearInterval(guard);observer?.disconnect();observer=null;video?.removeEventListener('pause',onPause);video?.removeEventListener('playing',onPlay);video?.removeEventListener('play',onPlay);if(phase==='replay'&&video){video.pause();video.playbackRate=previousRate}host?.remove();host=shadow=null;phase='off';phrase=null;wordEls=[];cueKey=''}
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(GEN!==globalThis.__takuGen)return;
  if(m.target!=='player')return;
  if(m.type==='probe'){if(findVideo())reply({video:true,version:VERSION});return}
  if(m.type==='start'){
   if(!findVideo())return;cleanup();video=findVideo();active=true;state('watching');video.addEventListener('pause',onPause);video.addEventListener('playing',onPlay);video.addEventListener('play',onPlay);
   guard=setInterval(()=>{
    if(GEN!==globalThis.__takuGen){clearInterval(guard);active=false;host?.remove();host=shadow=null;return}
    if(!active)return;
    if(!video.isConnected){const fresh=findVideo();if(fresh&&fresh!==video){video.removeEventListener('pause',onPause);video.removeEventListener('playing',onPlay);video.removeEventListener('play',onPlay);video=fresh;video.addEventListener('pause',onPause);video.addEventListener('playing',onPlay);video.addEventListener('play',onPlay)}else if(!fresh){cleanup();chrome.runtime.sendMessage({target:'worker',type:'stop'});return}}
    if(phase==='replay'&&video.currentTime>=replayEnd){video.pause();video.playbackRate=previousRate;phase='listening';send({type:'replay-ended'})}
    else if(!['watching','replay','off'].includes(phase))pauseAll();
    checkCue();
   },60);
   observer=new MutationObserver(()=>{if(active){position();checkCue()}});observer.observe(video.parentElement||document.documentElement,{subtree:true,childList:true,characterData:true});
   video.play().catch(error=>{if(active&&phase==='watching'&&error.name!=='AbortError')state('error','Press Play to begin.')});reply({ok:true});return;
  }
  if(m.type==='stop'){cleanup();reply({ok:true});return}if(!active)return;
  if(m.type==='pause'){phase='processing';cardAnchor='top';mount();position();pauseAll();segmentEnd=Math.max(0,video.currentTime-(m.delaySeconds||0));segmentStart=Math.max(0,segmentEnd-m.duration);phraseURL=location.href;reply({ok:true});return}
  if(m.type==='state'){state(m.phase,m.message);return}
  if(m.type==='phrase'){
   phrase=m.phrase;mount();showWords();$('meaning').textContent=phrase.meaning;$('japanese').textContent=phrase.japanese;$('words').replaceChildren();$('details').hidden=true;
   renderWords();return;
  }
  if(m.type==='phrase-details'){if(phrase){phrase.meaning=m.meaning;phrase.words=m.words||[];$('meaning').textContent=phrase.meaning;renderWords()}return}
  if(m.type==='phrase-tokens'){if(phrase&&m.tokens?.length){const done=wordEls.filter(el=>el.classList.contains('done')).length;phrase.tokens=m.tokens;showWords();progress(done)}return}
  if(m.type==='word-progress'){progress(m.count);return}
  if(m.type==='result'){if(m.passed){progress(wordEls.length);state('passed')}return}
  if(m.type==='resume'){phase='watching';cueKey='';video.playbackRate=previousRate;video.play().catch(()=>state('error','Press Play to continue.'));return}




  if(m.type==='replay'){replayEnd=segmentEnd;video.currentTime=segmentStart;state('replay');video.play().catch(()=>state('error','Couldn’t replay the line.'));return}
 });
 chrome.storage.onChanged.addListener(changes=>{if(changes.showJapanese&&$('japanese'))$('japanese').hidden=!changes.showJapanese.newValue});
 document.addEventListener('fullscreenchange',()=>{if(active)mount()});window.addEventListener('resize',()=>{if(active)position()});
 window.addEventListener('pagehide',()=>{if(active)chrome.runtime.sendMessage({target:'worker',type:'stop'}).catch(()=>{})});
})();
