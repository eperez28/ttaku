document.getElementById('allow').onclick=async()=>{
 const button=document.getElementById('allow');button.disabled=true;
 try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});stream.getTracks().forEach(t=>t.stop());await chrome.storage.local.set({micReady:true,lastError:''});document.getElementById('message').textContent='Your microphone is ready. You can close this window.';button.textContent='Close';button.disabled=false;button.onclick=()=>window.close()}
 catch(e){document.getElementById('message').textContent='Microphone access wasn’t allowed. You can try again.';button.disabled=false}
};
