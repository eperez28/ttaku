import {CONFIG} from './config.js';
let starting=false;
const offscreen=async()=>{if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','AUDIO_PLAYBACK'],justification:'Listen to anime tab audio and the learner microphone for Japanese practice.'})};
async function control(message){return chrome.runtime.sendMessage({target:'audio',...message})}
async function session(){return (await chrome.storage.session.get('session')).session}
async function stop(){
  const current=await session();
  await control({type:'stop'}).catch(()=>{});
  if(current)await chrome.tabs.sendMessage(current.tabId,{target:'player',type:'stop'}).catch(()=>{});
  await chrome.storage.session.remove('session');await chrome.action.setBadgeText({text:''});
}
async function start(tab){
  if(starting)throw Error('Taku is still starting. Give it a moment.');
  if(await session())throw Error('Taku is already running. Stop practice before starting another episode.');
  starting=true;
  try{
    if(!tab.url?.startsWith('https://www.crunchyroll.com/watch/')&&!tab.url?.startsWith('http://127.0.0.1:43127/'))throw Error('Open a Crunchyroll episode first.');
    const settings=await chrome.storage.local.get('micReady');
    if(!settings.micReady)throw Error('Allow microphone access before starting practice.');
    const health=await fetch(CONFIG.base+'/health',{signal:AbortSignal.timeout(2500)}).then(r=>r.json()).catch(()=>{throw Error('Start the Taku helper on your Mac, then try again.')});
    if(!health.ok)throw Error('The helper needs an OpenAI API key.');
    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']});
    const ready=await chrome.tabs.sendMessage(tab.id,{target:'player',type:'probe'});
    if(!ready?.video)throw Error('No video found yet. Start the episode once, then click Taku.');
    await offscreen();
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const id=crypto.randomUUID();
    await chrome.storage.session.set({session:{tabId:tab.id,id,frameId:ready.frameId||0,title:tab.title,url:tab.url}});
    const r=await control({type:'start',streamId,sessionId:id});
    if(r?.error)throw Error(r.error);
    await chrome.tabs.sendMessage(tab.id,{target:'player',type:'start',sessionId:id});
    await chrome.action.setBadgeBackgroundColor({color:'#dd583b'});await chrome.action.setBadgeText({text:'ON'});
  }catch(error){await stop();await chrome.storage.local.set({lastError:error.message});throw error}finally{starting=false}
}

chrome.tabs.onRemoved.addListener(async id=>{if((await session())?.tabId===id)await stop()});
chrome.commands.onCommand.addListener(async command=>{if(command==='capture-phrase')await control({type:'commit'}).catch(()=>{})});

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  const run=async()=>{
    if(m.target==='worker'&&m.type==='status')return {session:await session()};
    if(m.target==='worker'&&m.type==='start'){
      const tab=await chrome.tabs.get(m.tabId);await start(tab);await chrome.storage.local.set({lastError:''});return {ok:true};
    }
    if(m.target==='worker'&&m.type==='permission'){
      await chrome.windows.create({url:chrome.runtime.getURL('microphone.html'),type:'popup',width:390,height:330});return {ok:true};
    }
    if(m.target==='worker'&&m.type==='stop'){await stop();return {ok:true}}
    if(m.target==='worker'&&m.type==='save'){
      const {bank=[]}=await chrome.storage.local.get('bank');const key=m.word.japanese;
      const old=bank.find(x=>x.japanese===key);if(old){old.encounters++;old.lastSeen=Date.now()}else bank.unshift({...m.word,encounters:1,lastSeen:Date.now(),context:m.context});
      await chrome.storage.local.set({bank});return {ok:true};
    }
    if(m.target==='worker'&&m.type==='passed'){
      const {progress={phrases:0,attempts:0}}=await chrome.storage.local.get('progress');progress.phrases++;await chrome.storage.local.set({progress});return;
    }
    const current=await session();if(!current)return;
    if(m.target==='worker'&&m.type==='audio-event'){
      if(m.sessionId!==current.id)return;
      return chrome.tabs.sendMessage(current.tabId,{target:'player',...m.event}).catch(()=>{});
    }
    if(m.target==='worker'&&m.type==='player-event'&&sender.tab?.id===current.tabId){
      return control({...m.event,sessionId:current.id});
    }
  };
  if(m.target!=='worker')return;
  run().then(reply,e=>reply({error:e.message}));return true;
});
