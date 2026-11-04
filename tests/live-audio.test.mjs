import {test} from 'node:test';import assert from 'node:assert/strict';import {pcm24Base64} from '../extension/audio-utils.js';
test('microphone streaming uses mono PCM16 at 24 kHz',()=>{const chunk=new Float32Array(4800).fill(.5);const bytes=Buffer.from(pcm24Base64(chunk,48000),'base64');assert.equal(bytes.length,4800);assert.equal(bytes.readInt16LE(0),16384)});
test('resampling averages input samples without clipping',()=>{const bytes=Buffer.from(pcm24Base64(new Float32Array([1,-1,.5,.5]),48000),'base64');assert.equal(bytes.readInt16LE(0),0);assert.equal(bytes.readInt16LE(2),16384)});
