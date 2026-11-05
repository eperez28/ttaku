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
export function compactLines(lines,maxCharacters=90){
 const result=[];
 for(const line of lines){
  const tokens=line.tokens?.length?line.tokens:line.romaji.split(/\s+/).filter(Boolean).map(romaji=>({romaji,japanese:'',reading:''}));
  let group=[];
  const flush=()=>{if(!group.length)return;const full=group.length===tokens.length;result.push({...line,japanese:full?line.japanese:group.map(t=>t.japanese).join(''),reading:full?line.reading:group.map(t=>t.reading).join(''),romaji:group.map(t=>t.romaji).join(' '),tokens:group});group=[]};
  for(const token of tokens){if(group.length&&(group.map(t=>t.romaji).join(' ').length+token.romaji.length+1>maxCharacters||group.length>=14))flush();group.push(token)}flush();
 }
 return result;
}
