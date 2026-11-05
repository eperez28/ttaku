export function wavBase64(chunks,rate){
  const n=chunks.reduce((s,c)=>s+c.length,0);const bytes=new Uint8Array(44+n*2);const view=new DataView(bytes.buffer);
  const text=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i))};
  text(0,'RIFF');view.setUint32(4,36+n*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,n*2,true);
  let pos=44;for(const c of chunks)for(const f of c){view.setInt16(pos,Math.round(Math.max(-1,Math.min(1,f))*(f<0?32768:32767)),true);pos+=2}
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
}
export class Segmenter {
  constructor(rate,{maxSeconds=7,silenceSeconds=0.65,threshold=0.012}={}){this.rate=rate;this.maxSeconds=maxSeconds;this.silenceSeconds=silenceSeconds;this.threshold=threshold;this.reset()}
  reset(){this.pre=[];this.chunks=[];this.started=false;this.silence=0;this.total=0;this.voiced=0}
  push(chunk){
    let sum=0;for(const x of chunk)sum+=x*x;const rms=Math.sqrt(sum/chunk.length),dt=chunk.length/this.rate;
    const speech=rms>this.threshold;
    if(!this.started){this.pre.push(chunk);if(this.pre.length>Math.ceil(this.rate*0.25/chunk.length))this.pre.shift();if(!speech)return null;this.started=true;this.chunks=[...this.pre];this.pre=[]}
    else this.chunks.push(chunk);
    this.total+=dt;this.silence=speech?0:this.silence+dt;if(speech)this.voiced+=dt;
    if(this.total>=this.maxSeconds || (this.silence>=this.silenceSeconds&&this.total>0.5))return this.finish();
    return null;
  }
  finish(){const result=this.started&&this.voiced>=0.18?{chunks:this.chunks,duration:this.chunks.reduce((s,c)=>s+c.length,0)/this.rate}:null;this.reset();return result}
}

export function pcm24Base64(chunk,sourceRate){
 const ratio=sourceRate/24000,n=Math.floor(chunk.length/ratio),bytes=new Uint8Array(n*2),view=new DataView(bytes.buffer);
 for(let i=0;i<n;i++){const start=Math.floor(i*ratio),end=Math.min(chunk.length,Math.floor((i+1)*ratio));let value=0;for(let j=start;j<end;j++)value+=chunk[j];value/=Math.max(1,end-start);view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,value))*(value<0?32768:32767)),true)}
 let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}

export function pcm24Bytes(chunk, sourceRate) {
  const text = pcm24Base64(chunk, sourceRate);
  const binary = atob(text); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// Meta's completed-audio endpoint accepts mono PCM16 WAV at 16/24 kHz only,
// so resample the (usually 48 kHz) capture to 24 kHz before upload.
export function wav24Base64(chunks, sourceRate) {
  const ratio = sourceRate / 24000;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const n = Math.floor(total / ratio);
  const flat = new Float32Array(total); let o = 0;
  for (const c of chunks) { flat.set(c, o); o += c.length; }
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) { const start = Math.floor(i * ratio), end = Math.min(total, Math.floor((i + 1) * ratio)); let v = 0; for (let j = start; j < end; j++) v += flat[j]; samples[i] = v / Math.max(1, end - start); }
  return wavBase64([samples], 24000);
}
export function base64ToBytes(base64) {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
