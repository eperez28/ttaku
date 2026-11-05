export function cleanJapanese(text=''){
 return text.normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[^ぁ-ゖー一-龯a-z0-9]/gi,'').toLowerCase();
}
export function recognizedPrefix(tokens,transcript){
 const heard=cleanJapanese(transcript);if(!heard)return 0;
 let surface='',reading='',count=0;
 for(const token of tokens){surface+=cleanJapanese(token.japanese||token.text||'');reading+=cleanJapanese(token.reading||'');
  if((surface&&heard.startsWith(surface))||(reading&&heard.startsWith(reading)))count++;else break;
 }
 return count;
}
export function compactLines(lines,maxCharacters=52){
 const result=[];
 for(const line of lines){
  const tokens=line.tokens?.length?line.tokens:line.romaji.split(/\s+/).filter(Boolean).map(romaji=>({romaji,japanese:'',reading:''}));
  let group=[];
  const flush=()=>{if(!group.length)return;const full=group.length===tokens.length;result.push({...line,japanese:full?line.japanese:group.map(t=>t.japanese).join(''),reading:full?line.reading:group.map(t=>t.reading).join(''),romaji:group.map(t=>t.romaji).join(' '),tokens:group});group=[]};
  for(const token of tokens){if(group.length&&(group.map(t=>t.romaji).join(' ').length+token.romaji.length+1>maxCharacters||group.length>=8))flush();group.push(token)}flush();
 }
 return result;
}

export function japaneseChars(text=''){
 return (String(text).match(/[\u3040-\u30ff\u3400-\u9fff]/g)||[]).length;
}
// Judge whether a heard line is worth stopping the show for: enough actual
// Japanese and enough spoken time that it is a line, not a grunt or a laugh.
export function isPauseWorthy(text='',duration=0){
 if(japaneseChars(text)>=3 && duration>=0.7)return true;
 return japaneseChars(text)>=2 && duration>=0.8 && /[！!。]/.test(String(text));
}

const KANA3={sha:'しゃ',shu:'しゅ',sho:'しょ',cha:'ちゃ',chu:'ちゅ',cho:'ちょ',chi:'ち',tsu:'つ',shi:'し',jya:'じゃ',jyu:'じゅ',jyo:'じょ',ja:'じゃ',ju:'じゅ',jo:'じょ',ji:'じ',rya:'りゃ',ryu:'りゅ',ryo:'りょ',gya:'ぎゃ',gyu:'ぎゅ',gyo:'ぎょ',kya:'きゃ',kyu:'きゅ',kyo:'きょ',nya:'にゃ',nyu:'にゅ',nyo:'にょ',hya:'ひゃ',hyu:'ひゅ',hyo:'ひょ',bya:'びゃ',byu:'びゅ',byo:'びょ',pya:'ぴゃ',pyu:'ぴゅ',pyo:'ぴょ',mya:'みゃ',myu:'みゅ',myo:'みょ'};
const KANA2={ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',sa:'さ',su:'す',se:'せ',so:'そ',ta:'た',te:'て',to:'と',na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',ha:'は',hi:'ひ',fu:'ふ',he:'へ',ho:'ほ',ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',ya:'や',yu:'ゆ',yo:'よ',ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',wa:'わ',wo:'を',ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',za:'ざ',zu:'ず',ze:'ぜ',zo:'ぞ',da:'だ',de:'で',do:'ど',ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',ji:'じ'};
const KANA1={a:'あ',i:'い',u:'う',e:'え',o:'お'};
export function romajiToKana(word=''){
 let s=String(word).toLowerCase().replace(/[^a-z]/g,'');let out='',i=0;
 while(i<s.length){
  if(s[i]==='n'&&(i===s.length-1||!'aeiouy'.includes(s[i+1]))){out+='ん';i++;continue}
  if(s[i]===s[i+1]&&!'aeioun'.includes(s[i])){out+='っ';i++;continue}
  const three=s.slice(i,i+3),two=s.slice(i,i+2);
  if(KANA3[three]){out+=KANA3[three];i+=3;continue}
  if(KANA3[two]||KANA2[two]){out+=(KANA3[two]||KANA2[two]);i+=2;continue}
  if(KANA1[s[i]]){out+=KANA1[s[i]];i++;continue}
  i++;
 }
 return out;
}
export function displayTokens(romaji=''){
 return String(romaji).split(/\s+/).filter(Boolean).map(word=>({japanese:'',reading:word==='wa'?'は':word==='e'?'へ':word==='o'?'を':romajiToKana(word),romaji:word}));
}

export function recognizedMatches(tokens,transcript){
 const heard=cleanJapanese(transcript);const mask=[];let pos=0,partial=null;
 for(const token of tokens){
  const cands=[cleanJapanese(token.japanese||token.text||''),cleanJapanese(token.reading||'')].filter(Boolean);
  let idx=-1,len=0;
  for(const cand of cands){const i=heard.indexOf(cand,pos);if(i>=0&&i-pos<=8&&(idx<0||i<idx)){idx=i;len=cand.length}}
  if(idx>=0){mask.push(true);pos=idx+len}else mask.push(false);
 }
 for(let i=0;i<tokens.length;i++){
  if(mask[i])continue;
  const rest=heard.slice(pos);
  const cands=[cleanJapanese(tokens[i].japanese||tokens[i].text||''),cleanJapanese(tokens[i].reading||'')].filter(Boolean);
  const hit=cands.find(cand=>cand.length>rest.length&&cand.startsWith(rest)&&rest.length>=1);
  if(hit)partial={index:i,ratio:rest.length/hit.length};
  break;
 }
 return {mask,partial};
}

export function punctuateLine(line){
 if(!line||!line.romaji)return line;
 const jp=String(line.japanese||'');
 let mark='';
 if(/[！!]/.test(jp))mark='!';
 else if(/[？?]|か$|か[。！!]?$/.test(jp))mark='?';
 else if(/[。．.]/.test(jp)||jp)mark='.';
 if(!mark||/[.!?,]$/.test(line.romaji.trim()))return line;
 const romaji=line.romaji.trim()+mark;
 let tokens=line.tokens;
 if(tokens?.length){tokens=tokens.map((tok,i)=>i===tokens.length-1?{...tok,romaji:(tok.romaji||'').replace(/[.!?]+$/,'')+mark}:tok)}
 return {...line,romaji,tokens};
}

export function repeatKey(line){
 return (line?.romaji||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
export function mergeRepeats(lines){
 const out=[];const keys=[];
 for(const line of lines||[]){
  const key=repeatKey(line);
  if(out.length&&key&&keys[keys.length-1]===key){
   const prev=out[out.length-1];
   prev.japanese=(prev.japanese||'')+(line.japanese||'');
   prev.reading=(prev.reading||'')+(line.reading||'');
   prev.romaji=(prev.romaji||'')+' '+(line.romaji||'');
   prev.tokens=[...(prev.tokens||[]),...(line.tokens||[])];
  } else { out.push({...line}); keys.push(key); }
 }
 return out;
}

export function expandContractions(line){
 if(!line?.tokens?.length)return line;
 const AUX={mawashita:'まわした',mawashite:'まわして',mawasu:'まわす',shimatta:'しまった',shimatte:'しまって',shimau:'しまう',hajimeta:'はじめた',hajimete:'はじめて',hajimeru:'はじめる',sugita:'すぎた',sugite:'すぎて',sugiru:'すぎる',owatta:'おわった',owatte:'おわって',owaru:'おわる'};
 const tokens=[];
 for(const tok of line.tokens){
  const raw=String(tok.romaji||'');
  const punct=(raw.match(/[.,!?]+$/)||[''])[0];
  const word=raw.slice(0,raw.length-punct.length);
  const lower=word.toLowerCase();
  let stem=null,suffixRomaji=null,suffixKana=null;
  const contracted=lower.match(/^(.{2,}?)(chatte|jatte)$/);
  const auxHit=Object.keys(AUX).find(suf=>lower.endsWith(suf)&&word.length-suf.length>=3);
  if(contracted){stem=contracted[1];suffixRomaji=contracted[2];suffixKana=contracted[2]==='chatte'?'ちゃって':'じゃって'}
  else if(auxHit){stem=word.slice(0,word.length-auxHit.length);suffixRomaji=auxHit;suffixKana=AUX[auxHit]}
  if(!stem){tokens.push(tok);continue}
  const stemReading=String(tok.reading||'').endsWith(suffixKana)?String(tok.reading).slice(0,String(tok.reading).length-suffixKana.length):String(tok.reading||'');
  const jp=String(tok.japanese||'');
  const jpStem=jp.endsWith(suffixKana)?jp.slice(0,jp.length-suffixKana.length):jp;
  const jpSuffix=jp.endsWith(suffixKana)?suffixKana:'';
  tokens.push({...tok,romaji:stem,reading:stemReading,japanese:jpStem});
  tokens.push({japanese:jpSuffix,reading:suffixKana,romaji:suffixRomaji+punct});
 }
 return {...line,tokens,romaji:tokens.map(tok=>tok.romaji).join(' ')};
}
export function normalizeFiller(line){
 if(!line||!/^[んン]/.test(String(line.japanese||'')))return line;
 const first=String(line.romaji||'').trim().split(/\s+/)[0]||'';
 if(!/^n+[,.]?$/i.test(first))return line;
 const romaji=String(line.romaji||'').replace(/^\s*n+[,.]?/i,'nnn'+(first.includes(',')?',':''));
 const tokens=line.tokens?.map((tok,i)=>i===0?{...tok,romaji:'nnn'+((tok.romaji||'').includes(',')?',':'')}:tok);
 return {...line,romaji,tokens};
}

export function matchCoverage(tokens,mask){
 let total=0,hit=0;
 (tokens||[]).forEach((tok,i)=>{const len=(tok.reading||tok.romaji||'').length||1;total+=len;if(mask?.[i])hit+=len});
 return total?hit/total:0;
}

export function isSubstantialLine(line){
 if(!line)return false;
 const jp=(String(line.japanese||'').match(/[\u3040-\u30ff\u3400-\u9fff]/g)||[]).length;
 const words=String(line.romaji||'').split(/\s+/).filter(Boolean).length;
 return jp>=3&&words>=2;
}
// The practice line is the first substantial line in the clip — never a
// leading interjection ("Oi,", "Hey,") with the real sentence behind it.
export function pickPracticeLine(lines){
 return (lines||[]).find(isSubstantialLine)||null;
}

// Everything heard in the clip is the practice text: all of its lines
// joined into one block that wraps on screen. Pieces that restate the
// seam (a stray first word, then the whole phrase) are merged, not doubled.
export function combineLines(lines){
 const usable=(lines||[]).filter(l=>l&&l.romaji);
 if(!usable.length)return null;
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g,'');
 const lineTokens=usable.map(l=>l.tokens?.length?l.tokens:displayTokens(l.romaji));
 // Drop a piece that is just the beginning of the next piece, restated.
 const kept=[];
 for(let i=0;i<usable.length;i++){
  const jpHere=norm(lineTokens[i].map(tok=>tok.japanese||'').join('')||usable[i].japanese);
  const jpNext=i+1<usable.length?norm(lineTokens[i+1].map(tok=>tok.japanese||'').join('')||usable[i+1].japanese):'';
  if(jpHere.length>=2&&jpNext.startsWith(jpHere)&&jpNext.length>jpHere.length)continue;
  kept.push(i);
 }
 const tokens=[];let firstKept=null;
 for(const i of kept){
  let toks=lineTokens[i];
  // Seam overlap: if this piece starts with the words the block already
  // ends with, those words are said once.
  let overlap=0;
  for(let k=Math.min(3,tokens.length,toks.length);k>=1;k--){
   const tail=tokens.slice(-k).map(tok=>norm(tok.romaji)).join('|');
   const head=toks.slice(0,k).map(tok=>norm(tok.romaji)).join('|');
   if(tail&&tail===head){overlap=k;break}
  }
  toks=toks.slice(overlap);
  if(!toks.length)continue;
  if(!firstKept)firstKept=usable[i];
  tokens.push(...toks);
 }
 if(!tokens.length)return null;
 return {
  japanese:tokens.map(tok=>tok.japanese||'').join(''),
  reading:tokens.map(tok=>tok.reading||'').join(''),
  romaji:tokens.map(tok=>tok.romaji).join(' '),
  tokens,
  words:firstKept?.words||[],
  meaning:''
 };
}
