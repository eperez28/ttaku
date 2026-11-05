import {test} from 'node:test';import assert from 'node:assert/strict';import {recognizedPrefix,compactLines,isPauseWorthy,romajiToKana,displayTokens,recognizedMatches,matchCoverage,punctuateLine,mergeRepeats,expandContractions,normalizeFiller,pickPracticeLine,isSubstantialLine,combineLines} from '../extension/word-progress.js';
const tokens=[{japanese:'大丈夫',reading:'だいじょうぶ',romaji:'daijoubu'},{japanese:'です',reading:'です',romaji:'desu'},{japanese:'か',reading:'か',romaji:'ka?'}];
test('partial recognition fills only complete words in order',()=>{assert.equal(recognizedPrefix(tokens,'大'),0);assert.equal(recognizedPrefix(tokens,'大丈夫'),1);assert.equal(recognizedPrefix(tokens,'大丈夫です'),2);assert.equal(recognizedPrefix(tokens,'大丈夫ですか？'),3)});
test('kana transcription also matches the target reading',()=>assert.equal(recognizedPrefix(tokens,'ダイジョウブです'),2));
test('wrong or out-of-order words never advance the prefix',()=>{assert.equal(recognizedPrefix(tokens,'ありがとうございます'),0);assert.equal(recognizedPrefix(tokens,'ですか'),0);assert.equal(recognizedPrefix(tokens,''),0)});
test('long source phrases split into single short lines without losing tokens',()=>{const input={japanese:'大丈夫ですか'.repeat(5),reading:'だいじょうぶですか'.repeat(5),romaji:tokens.map(t=>t.romaji).join(' '),tokens:Array.from({length:5},()=>tokens).flat(),words:[]};const lines=compactLines([input]);assert.ok(lines.length>1);assert.equal(lines.flatMap(l=>l.tokens).length,15);for(const line of lines){assert.ok(line.romaji.length<=52);assert.ok(line.tokens.length<=8)}});

test('only real lines earn a pause: grunts and fragments play through',()=>{assert.equal(isPauseWorthy('うん',1.2),false);assert.equal(isPauseWorthy('行くぞ',0.4),false);assert.equal(isPauseWorthy('ありがとう',0.3),false);assert.equal(isPauseWorthy('海賊狩りのゾロ',2.1),true);assert.equal(isPauseWorthy('thank you',2.1),false)});

test('romaji converts to kana for instant display tokens',()=>{assert.equal(romajiToKana('daijoubu'),'だいじょうぶ');assert.equal(romajiToKana('kaizoku'),'かいぞく');assert.equal(romajiToKana('gakkou'),'がっこう');const toks=displayTokens('boku wa iku');assert.equal(toks[1].reading,'は');assert.equal(toks[2].reading,'いく')});

test('fill lights each word you actually said, even after a misheard word',()=>{const {mask}=recognizedMatches(tokens,'大丈夫ですか');assert.deepEqual(mask,[true,true,true]);const mid=recognizedMatches(tokens,'大丈夫です');assert.deepEqual(mid.mask,[true,true,false]);const again=recognizedMatches(tokens,'大丈夫ですか？');assert.deepEqual(again.mask,[true,true,true])});
test('a half-spoken next word reports a partial fill',()=>{const {mask,partial}=recognizedMatches(tokens,'大丈夫で');assert.deepEqual(mask,[true,false,false]);assert.equal(partial.index,1);assert.ok(partial.ratio>0&&partial.ratio<1)});

test('lines end with the punctuation the sentence needs',()=>{assert.equal(punctuateLine({japanese:'行くぞ。',romaji:'iku zo',tokens:[{romaji:'iku'},{romaji:'zo'}]}).romaji,'iku zo.');assert.equal(punctuateLine({japanese:'行けるか',romaji:'ikeru ka'}).romaji,'ikeru ka?');assert.equal(punctuateLine({japanese:'行くぞ！',romaji:'iku zo!'}).romaji,'iku zo!')});

test('repeated lines merge into one wrapped block',()=>{const line={japanese:'こういうもんだ。',reading:'こういうもんだ',romaji:'kou iu mon da.',tokens:[{romaji:'kou'},{romaji:'iu'}]};const merged=mergeRepeats([line,line,line]);assert.equal(merged.length,1);assert.equal(merged[0].romaji,'kou iu mon da. kou iu mon da. kou iu mon da.');assert.equal(merged[0].tokens.length,6);const mixed=mergeRepeats([line,{...line,romaji:'iku zo.',japanese:'行くぞ。'}]);assert.equal(mixed.length,2)});

test('verb contractions split into stem and ending for learners',()=>{const out=expandContractions({japanese:'飲まれちゃってさ',reading:'のまれちゃってさ',romaji:'nomarechatte sa',tokens:[{japanese:'飲まれちゃって',reading:'のまれちゃって',romaji:'nomarechatte'},{japanese:'さ',reading:'さ',romaji:'sa'}]});assert.deepEqual(out.tokens.map(t=>t.romaji),['nomare','chatte','sa']);assert.equal(out.tokens[1].reading,'ちゃって')});
test('a leading filler sound reads as nnn, not the letter N',()=>{const out=normalizeFiller({japanese:'ん、俺の船',romaji:'N, ore no fune',tokens:[{japanese:'ん',reading:'ん',romaji:'N,'}]});assert.equal(out.romaji,'nnn, ore no fune');assert.equal(out.tokens[0].romaji,'nnn,')});

test('live coverage counts matched sounds across the line',()=>{const toks=[{reading:'あ'},{reading:'いう'},{reading:'えお'}];assert.ok(Math.abs(matchCoverage(toks,[true,true,false])-0.6)<0.001);assert.equal(matchCoverage(toks,[true,true,true]),1)});

test('the practice line is the real sentence, not the shout before it',()=>{const lines=[{japanese:'おい、',reading:'おい',romaji:'Oi,'},{japanese:'俺の船を見ろ',reading:'おれのふねをみろ',romaji:'ore no fune wo miro'}];assert.equal(pickPracticeLine(lines).romaji,'ore no fune wo miro');assert.equal(pickPracticeLine([lines[0]]),null);assert.equal(isSubstantialLine(lines[1]),true)});

test('everything heard displays as one wrapped block, not pieces',()=>{const lines=[{japanese:'おい、',reading:'おい',romaji:'Oi,',tokens:[{romaji:'Oi,'}]},{japanese:'俺の船を見ろ',reading:'おれのふねをみろ',romaji:'ore no fune wo miro',tokens:[{romaji:'ore'},{romaji:'miro'}]}];const all=combineLines(lines);assert.equal(all.romaji,'Oi, ore miro');assert.equal(all.tokens.length,3);assert.equal(combineLines([]),null)});

test('compound verbs split into stem and ending',()=>{const out=expandContractions({japanese:'引っ掻き回した',reading:'ひっかきまわした',romaji:'hikkakimawashita',tokens:[{japanese:'引っ掻き回した',reading:'ひっかきまわした',romaji:'hikkakimawashita'}]});assert.deepEqual(out.tokens.map(t=>t.romaji),['hikkaki','mawashita']);assert.equal(out.tokens[0].reading,'ひっかき');assert.equal(out.romaji,'hikkaki mawashita')});

test('a restated seam is said once, not twice',()=>{const lines=[{japanese:'おう',reading:'おう',romaji:'Ou',tokens:[{japanese:'おう',reading:'おう',romaji:'Ou'}]},{japanese:'おう待てろ',reading:'おうまてろ',romaji:'Ou matte ro',tokens:[{japanese:'おう',reading:'おう',romaji:'Ou'},{japanese:'待てろ',reading:'まてろ',romaji:'matte ro'}]}];const all=combineLines(lines);assert.equal(all.romaji,'Ou matte ro');assert.equal(all.japanese,'おう待てろ')});

test('fill finds later words even when an earlier word was garbled far behind',()=>{const {mask}=recognizedMatches(tokens,'ぜんぜんちがうけど大丈夫です');assert.equal(mask[1],true);assert.equal(mask[0],true)});
