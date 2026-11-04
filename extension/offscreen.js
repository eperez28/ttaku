import {CONFIG} from './config.js';
import {Segmenter,wavBase64,pcm24Base64} from './audio-utils.js';
import {recognizedPrefix} from './word-progress.js';
let context,tabStream,micStream,sessionId,phase='off',phrase=null,lines=[],lineIndex=0,tabSegments,micSegments,epoch=0,armedAt=0,aborter,live=null,liveReady=false,liveQueue=[],liveTexts=new Map();
const emit=event=>chrome.runtime.sendMessage({target:'worker',type:'audio-event',sessionId,event}).catch(()=>{});
async function request(route,body){
 const controller=new AbortController();aborter=controller;const timer=setTimeout(()=>controller.abort(),55000);
 try{const r=await fetch(CONFIG.base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Taku-Token':CONFIG.token},body:JSON.stringify(body),signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(data.error||'The helper could not process this clip.');return data}finally{clearTimeout(timer)}
}
async function node(stream,callback){
 const source=context.createMediaStreamSource(stream),worklet=new AudioWorkletNode(context,'taku-pcm'),silent=context.createGain();silent.gain.value=0;source.connect(worklet);worklet.connect(silent);silent.connect(context.destination);worklet.port.onmessage=e=>callback(e.data);return source;
}
function closeLive(commit=false){const ws=live;live=null;liveReady=false;liveQueue=[];liveTexts=new Map();if(ws){if(commit&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'commit'}));setTimeout(()=>ws.close(),900)}else ws.close()}}
function openLive(){
 closeLive();const ws=new WebSocket(CONFIG.base.replace('http:','ws:')+'/live-check');live=ws;
 ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token:CONFIG.token}));
 ws.onmessage=e=>{
  if(ws!==live)return;const m=JSON.parse(e.data);
  if(m.type==='ready'){liveReady=true;for(const audio of liveQueue)ws.send(JSON.stringify({type:'audio',audio}));liveQueue=[]}
  if((m.type==='delta'||m.type==='final')&&phrase&&['listening','checking'].includes(phase)){
   const text=m.type==='final'?m.text:(liveTexts.get(m.itemId)||'')+m.text;liveTexts.set(m.itemId,text);
   emit({type:'word-progress',count:recognizedPrefix(phrase.tokens||[],text)});
  }
  // Final recorded-audio matching remains available if live recognition disconnects.
 };
 ws.onerror=()=>{};ws.onclose=()=>{if(ws===live){live=null;liveReady=false;liveQueue=[]}};
}
function streamMic(chunk){
 if(!live)openLive();const audio=pcm24Base64(chunk,context.sampleRate);
 if(liveReady&&live?.readyState===WebSocket.OPEN)live.send(JSON.stringify({type:'audio',audio}));else if(liveQueue.length<150)liveQueue.push(audio);
}
function listen(){phase='listening';micSegments.reset();armedAt=performance.now()+450;emit({type:'word-progress',count:0});emit({type:'state',phase,message:''});openLive()}
function showLine(){phrase=lines[lineIndex];emit({type:'phrase',phrase,lineIndex,lineCount:lines.length});listen()}
function advance(){
 closeLive();if(lineIndex+1<lines.length){epoch++;lineIndex++;showLine()}else resume();
}
async function analyze(segment){
 const ticket=++epoch;phase='processing';emit({type:'pause',duration:segment.duration});emit({type:'state',phase,message:'Getting this line…'});
 try{
  const result=await request('/phrase',{audioBase64:wavBase64(segment.chunks,context.sampleRate)});if(ticket!==epoch)return;
  if(result.empty){phase='empty';emit({type:'state',phase,message:'I couldn’t make out that line.'});return}
  lines=result.lines?.length?result.lines:[result];lineIndex=0;showLine();
 }catch(error){if(ticket===epoch){phase='error';emit({type:'state',phase,message:error.message})}}
}
async function check(segment){
 const ticket=++epoch;phase='checking';closeLive(true);emit({type:'state',phase,message:''});
 try{
  const result=await request('/attempt',{audioBase64:wavBase64(segment.chunks,context.sampleRate),reading:phrase.reading});if(ticket!==epoch)return;
  emit({type:'result',...result});
  if(result.passed){phase='passed';emit({type:'word-progress',count:phrase.tokens?.length||100});await chrome.runtime.sendMessage({target:'worker',type:'passed'});setTimeout(()=>{if(ticket===epoch)advance()},650)}
  else{phase='retry';emit({type:'state',phase,message:result.heard?'Try that line again.':'I couldn’t hear you.'});setTimeout(()=>{if(ticket===epoch)listen()},1300)}
 }catch(error){if(ticket===epoch){phase='error';emit({type:'state',phase,message:error.message})}}
}
function resume(){epoch++;aborter?.abort();closeLive();phase='watching';phrase=null;lines=[];lineIndex=0;tabSegments.reset();micSegments.reset();armedAt=performance.now()+180;emit({type:'resume'});emit({type:'state',phase,message:''})}
async function stop(){epoch++;aborter?.abort();closeLive();phase='off';for(const stream of [tabStream,micStream])stream?.getTracks().forEach(t=>t.stop());tabStream=micStream=null;if(context){await context.close();context=null}}
async function start(m){
 await stop();sessionId=m.sessionId;
 try{
  tabStream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId}},video:false});
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  context=new AudioContext();await context.resume();await context.audioWorklet.addModule('pcm-worklet.js');
  tabSegments=new Segmenter(context.sampleRate,{maxSeconds:3.5,silenceSeconds:.38});micSegments=new Segmenter(context.sampleRate,{maxSeconds:14,silenceSeconds:.85,threshold:.018});
  const tabSource=await node(tabStream,chunk=>{if(phase==='watching'&&performance.now()>armedAt){const segment=tabSegments.push(chunk);if(segment)analyze(segment)}});tabSource.connect(context.destination);
  await node(micStream,chunk=>{
   if(phase!=='listening'||performance.now()<armedAt)return;
   const started=micSegments.started,segment=micSegments.push(chunk);
   if(!started&&micSegments.started){for(const pre of micSegments.chunks.slice(0,-1))streamMic(pre)}
   if(started||micSegments.started||segment)streamMic(chunk);
   if(segment)check(segment);
  });
  tabStream.getAudioTracks().forEach(t=>t.onended=()=>{stop();emit({type:'state',phase:'error',message:'Tab sharing ended. Restart Taku to reconnect.'})});
  phase='watching';armedAt=performance.now()+200;return {ok:true};
 }catch(error){await stop();throw error}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m.target!=='audio'||sender.id!==chrome.runtime.id)return;
 const run=async()=>{
  if(m.type==='start')return start(m);
  if(m.type==='stop'){await stop();return {ok:true}}
  if(m.sessionId&&m.sessionId!==sessionId)return;
  if(m.type==='skip'){epoch++;aborter?.abort();if(phrase)advance();else resume();return {ok:true}}
  if(m.type==='retry'&&phrase){epoch++;aborter?.abort();listen();return {ok:true}}
  if(m.type==='replay'&&phrase){epoch++;aborter?.abort();closeLive();phase='replay';emit({type:'replay'});return {ok:true}}
  if(m.type==='replay-ended'){listen();return {ok:true}}
  if(m.type==='commit'||m.type==='caption-boundary'){
   if(phase==='watching'){const s=tabSegments.finish();if(s)analyze(s)}else if(phase==='listening'&&m.type==='commit'){const s=micSegments.finish();if(s)check(s)}return {ok:true};
  }
  if(m.type==='video-paused'&&phase==='watching'){tabSegments.reset();armedAt=Infinity}
  if(m.type==='video-playing'&&phase==='watching'){tabSegments.reset();armedAt=performance.now()+120}
  return {ok:true};
 };
 run().then(reply,e=>reply({error:e.message}));return true;
});
