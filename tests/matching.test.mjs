import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeReading,matchReading,readingToRomaji} from '../extension/matching.js';
import {Segmenter,wavBase64} from '../extension/audio-utils.js';
test('Japanese reading normalizes katakana and punctuation',()=>assert.equal(normalizeReading('ダイジョウブ。'),'たいしょうふ'));
test('empty speech and unrelated speech never pass',()=>{assert.equal(matchReading('だいじょうぶ','').passed,false);assert.equal(matchReading('だいじょうぶ','ありがとう').passed,false)});
test('short words still need the right sounds',()=>{assert.equal(matchReading('はい','はい').passed,true);assert.equal(matchReading('はい','いいえ').passed,false);assert.equal(matchReading('すし','ねこ').passed,false)});
test('long phrases tolerate a small error, reject a partial answer',()=>{assert.equal(matchReading('ありがとうございます','ありがとございます').passed,true);assert.equal(matchReading('ありがとうございます','ありがとう').passed,false)});
test('silence alone does not produce a billable clip',()=>{const s=new Segmenter(1000);for(let i=0;i<100;i++)assert.equal(s.push(new Float32Array(100)),null);assert.equal(s.finish(),null)});
test('speech followed by silence ends an utterance',()=>{const s=new Segmenter(1000);for(let i=0;i<5;i++)assert.equal(s.push(new Float32Array(100).fill(.2)),null);let result;for(let i=0;i<7;i++)result=s.push(new Float32Array(100))||result;assert.ok(result.duration>=1);assert.equal(s.finish(),null)});
test('continuous soundtrack produces bounded phrases',()=>{const s=new Segmenter(1000,{maxSeconds:3});let result;for(let i=0;i<30;i++)result=s.push(new Float32Array(100).fill(.1))||result;assert.ok(result);assert.ok(result.duration<=3.2)});
test('WAV encoder writes mono PCM with the right size',()=>{const b=Buffer.from(wavBase64([new Float32Array([0,1,-1])],24000),'base64');assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(24),24000);assert.equal(b.readUInt32LE(40),6);assert.equal(b.readInt16LE(46),32767);assert.equal(b.readInt16LE(48),-32768)});

test('quiet dialogue under the old RMS floor still cuts a clip',()=>{const s=new Segmenter(48000,{maxSeconds:3.5,silenceSeconds:.38,threshold:.005,peakThreshold:.04});let result=null;const quiet=new Float32Array(2048);for(let i=0;i<quiet.length;i++)quiet[i]=(i%64<32?.09:-.09);for(let i=0;i<40&&!result;i++)result=s.push(quiet);for(let i=0;i<12&&!result;i++)result=s.push(new Float32Array(2048));assert.ok(result,'expected a clip from quiet-but-peaky dialogue')});

test('80 percent right passes at any length, accent folds count as the same sound',()=>{assert.equal(matchReading('ありがとう','ありがと').passed,true);assert.equal(matchReading('がっこう','かっこう').passed,true);assert.equal(matchReading('つづく','つずく').passed,true);assert.equal(matchReading('ありがとう','ぜんぜんちがう').passed,false)});

test('accent-shaped mistakes still pass: voicing and long vowels fold',()=>{assert.equal(matchReading('だめ','ため').passed,true);assert.equal(matchReading('がっこう','かこう').passed,true);assert.equal(matchReading('ありがとうございます','ありがとございます').passed,true);assert.equal(matchReading('せんせい','せんせ').passed,true)});

test('the flap is one sound: soft-d and l hearings of ru pass',()=>{assert.equal(matchReading('るふぃくん','どぅふぃくん').passed,true);assert.equal(matchReading('るふぃくん','ねこくん').passed,false);const romajiDirect=matchReading('るふぃくん','Rufi-kun');assert.equal(romajiDirect.passed,true);assert.equal(readingToRomaji('がっこう'),'gakkou')});
