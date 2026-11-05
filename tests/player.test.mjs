import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
function harness(){
 const elements=new Map(),messages=[],timers=[];
 function element(){const classes=new Set();return {style:{setProperty(){}},dataset:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)},contains:name=>classes.has(name)},textContent:'',scrollWidth:0,children:[],setAttribute(){},addEventListener(){},append(...xs){this.children.push(...xs);for(const x of xs)x.parentNode=this},replaceChildren(){this.children=[]},remove(){this.parentNode=null},attachShadow(){return {set innerHTML(v){},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}}}}}
 const root=element(),video={paused:true,currentTime:20,playbackRate:1,isConnected:true,clientWidth:1280,clientHeight:720,textTracks:[],parentElement:root,getBoundingClientRect:()=>({width:1280,height:720,left:0,top:0,bottom:720}),pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()},addEventListener(){},removeEventListener(){}};
 let listener;const document={documentElement:root,fullscreenElement:null,title:'Episode',createElement:()=>element(),querySelectorAll:selector=>selector==='video'?[video]:[],addEventListener(){}};
 const docListeners={};document.addEventListener=(name,fn)=>{docListeners[name]=fn};
 const context=vm.createContext({document,innerHeight:720,location:{href:'https://www.crunchyroll.com/watch/test'},MutationObserver:class{observe(){}disconnect(){}},chrome:{storage:{local:{get:async()=>({showJapanese:false})},onChanged:{addListener(){}}},runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener(fn){listener=fn}},sendMessage(m){messages.push(m);return Promise.resolve({ok:true})}}},setInterval(fn){timers.push(fn);return 1},clearInterval(){},setTimeout(){return 1},clearTimeout(){},window:{addEventListener(){}}});
 vm.runInContext(readFileSync(new URL('../extension/content.js',import.meta.url),'utf8'),context);
 return {video,elements,messages,docListeners,tick:()=>timers.at(-1)?.(),send:m=>listener({target:'player',...m},{},()=>{})};
}
test('player stays paused during speech, failed recognition and API errors',()=>{const h=harness();h.send({type:'start'});h.send({type:'pause',duration:4});for(const phase of ['listening','checking','retry','error']){h.send({type:'state',phase});h.video.paused=false;h.tick();assert.equal(h.video.paused,true,phase)}});
test('resume releases the pause guard and starts video',()=>{const h=harness();h.send({type:'start'});h.send({type:'pause',duration:4});h.send({type:'resume'});h.tick();assert.equal(h.video.paused,false)});
test('replay pauses at the original end and returns to learner listening',()=>{const h=harness();h.send({type:'start'});h.send({type:'pause',duration:4});h.send({type:'replay'});assert.equal(h.video.currentTime,16);assert.equal(h.video.paused,false);h.video.currentTime=20;h.tick();assert.equal(h.video.paused,true);assert.equal(h.messages.at(-1).event.type,'replay-ended')});
test('only recognized words fill; a new line starts hollow',()=>{
 const h=harness();h.send({type:'start'});const phrase={romaji:'daijoubu desu ka',japanese:'大丈夫ですか',meaning:'Are you okay?',tokens:[{romaji:'daijoubu'},{romaji:'desu'},{romaji:'ka'}],words:[]};h.send({type:'phrase',phrase});const line=h.elements.get('romaji');assert.equal(line.children.filter(w=>w.classList.contains('done')).length,0);h.send({type:'word-progress',count:2});assert.deepEqual(line.children.map(w=>w.classList.contains('done')),[true,true,false]);h.send({type:'phrase',phrase});assert.equal(line.children.filter(w=>w.classList.contains('done')).length,0);
});

test('unconfirmed audio never pauses: empty/error while watching keeps playing',()=>{const h=harness();h.send({type:'start'});h.video.paused=false;h.send({type:'state',phase:'empty',message:'x'});h.tick();assert.equal(h.video.paused,false);h.send({type:'state',phase:'error',message:'x'});h.tick();assert.equal(h.video.paused,false)});

test('mode switch pauses while readjusting, then plays in the new mode',()=>{const h=harness();h.send({type:'start',mode:'rehearse'});h.video.paused=false;h.send({type:'mode-pause'});assert.equal(h.video.paused,true);h.send({type:'set-mode',mode:'karaoke'});assert.equal(h.video.paused,false)});

test('seek-back rewinds 10s and plays',()=>{const h=harness();h.send({type:'start',mode:'rehearse'});h.video.currentTime=42;h.video.paused=true;h.send({type:'seek-back',seconds:10});assert.equal(h.video.currentTime,32);assert.equal(h.video.paused,false);});

test('karaoke shows the line at the top without pausing the video',()=>{const h=harness();h.send({type:'start',mode:'karaoke'});h.video.paused=false;h.send({type:'karaoke-phrase',phrase:{romaji:'iku zo',japanese:'行くぞ',meaning:'Let us go',tokens:[{romaji:'iku'},{romaji:'zo'}],words:[]}});assert.equal(h.video.paused,false);assert.equal(h.elements.get('romaji').children.length,2)});
