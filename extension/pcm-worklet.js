class PCM extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.pos=0}
  process(inputs){const channels=inputs[0];if(channels?.length){for(let i=0;i<channels[0].length;i++){let v=0;for(const c of channels)v+=c[i];this.buffer[this.pos++]=v/channels.length;if(this.pos===this.buffer.length){this.port.postMessage(this.buffer);this.buffer=new Float32Array(2048);this.pos=0}}}return true}
}
registerProcessor('taku-pcm',PCM);
