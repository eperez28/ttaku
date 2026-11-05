export function normalizeReading(s = '') {
  return s.normalize('NFKC').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    // Accent-shaped differences count as the same sound on both sides:
    // づ/ぢ voicing, dropped gemination, を/は readings.
    .replace(/づ/g, 'ず').replace(/ぢ/g, 'じ')
    .replace(/っ/g, '').replace(/を/g, 'お').replace(/は/g, 'わ')
    // Voicing is the first thing an accent moves: fold it away entirely.
    .replace(/[がぎぐげご]/g, c => 'かきくけこ'['がぎぐげご'.indexOf(c)])
    .replace(/[ざじずぜぞ]/g, c => 'さしすせそ'['ざじずぜぞ'.indexOf(c)])
    .replace(/[だぢづでど]/g, c => 'たちつてと'['だぢづでど'.indexOf(c)])
    .replace(/[ばびぶべぼぱぴぷぺぽ]/g, c => 'はひふへほはひふへほ'['ばびぶべぼぱぴぷぺぽ'.indexOf(c)])
    // Long vowels: ou/ei spelling and held vowels count as one sound.
    .replace(/ー/g, '').replace(/([おこそとのほもよろごぞどぼぽ])う/g, '$1').replace(/([えけせてねへめれげぜでべぺ])い/g, '$1')
    .replace(/([あいうえお])\1+/g, '$1')
    .replace(/[^ぁ-ゖーa-z0-9]/gi, '').toLowerCase();
}
export function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)); row = next; }
  return row[b.length];
}
const ROMAJI2 = { 'きゃ':'kya','きゅ':'kyu','きょ':'kyo','しゃ':'sha','しゅ':'shu','しょ':'sho','ちゃ':'cha','ちゅ':'chu','ちょ':'cho','にゃ':'nya','にゅ':'nyu','にょ':'nyo','ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo','みゃ':'mya','みゅ':'myu','みょ':'myo','りゃ':'rya','りゅ':'ryu','りょ':'ryo','ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo','じゃ':'ja','じゅ':'ju','じょ':'jo','ぢゃ':'ja','ぢゅ':'ju','ぢょ':'jo','びゃ':'bya','びゅ':'byu','びょ':'byo','ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo','ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','てぃ':'ti','でぃ':'di','とぅ':'tu','どぅ':'du','ちぇ':'che','じぇ':'je','しぇ':'she' };
const ROMAJI1 = { 'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko','さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to','な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no','は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho','ま':'ma','み':'mi','む':'mu','め':'me','も':'mo','や':'ya','ゆ':'yu','よ':'yo','ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','を':'wo','ん':'n','が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo','だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo','ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po','ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゃ':'ya','ゅ':'yu','ょ':'yo' };
export function readingToRomaji(reading = '') {
  const s = String(reading).normalize('NFKC').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  let out = '', geminate = false;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (ROMAJI2[two]) { out += (geminate && !'aiueon'.includes(ROMAJI2[two][0]) ? ROMAJI2[two][0] : '') + ROMAJI2[two]; geminate = false; i++; continue; }
    const ch = s[i];
    if (ch === 'っ') { geminate = true; continue; }
    if (ch === 'ー') { const v = out.match(/[aiueo](?=[^aiueo]*$)/); if (v) out += v[0]; continue; }
    if (ROMAJI1[ch]) { out += (geminate && !'aiueon'.includes(ROMAJI1[ch][0]) ? ROMAJI1[ch][0] : '') + ROMAJI1[ch]; geminate = false; }
  }
  return out;
}
export function normalizeRomaji(s = '') {
  return String(s).toLowerCase().replace(/[^a-z]/g, '')
    // The Japanese flap (ら-row) sits between r, l, and a soft d: one sound.
    .replace(/l/g, 'r').replace(/du/g, 'ru').replace(/di/g, 'ri')
    .replace(/hu/g, 'fu').replace(/si/g, 'shi').replace(/ti/g, 'chi').replace(/tu/g, 'tsu').replace(/zi/g, 'ji');
}
function similarityOf(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length));
}
const LEADING_FILLERS = ['おう', 'おお', 'ああ', 'ええ', 'うん', 'お', 'あ', 'え', 'ん'];
export function stripLeadingFiller(reading = '') {
  let s = String(reading);
  for (const f of LEADING_FILLERS) {
    if (s.startsWith(f) && s.length - f.length >= 2) { s = s.slice(f.length); break; }
  }
  return s;
}
export function matchReading(expected, actual) {
  const a = normalizeReading(expected), b = normalizeReading(actual);
  if (!a || !b) return { passed: false, similarity: 0 };
  // A throwaway opening shout (お/あ/うん…) is not the line: it neither
  // earns nor costs anything on either side.
  const aCore = stripLeadingFiller(a), bCore = stripLeadingFiller(b);
  const kanaScore = Math.max(similarityOf(a, b), similarityOf(aCore, bCore));
  // Judge in romaji too: readings converted to romaji, flap/l/hu variants
  // folded, so saying the line the way it sounds passes even when the
  // recognizer wrote it with different kana. Romaji input works directly.
  const romajiOf = x => normalizeRomaji(/[a-z]/i.test(String(x)) && !/[ぁ-ゖァ-ヶ]/.test(String(x)) ? x : readingToRomaji(x));
  const romajiScore = similarityOf(romajiOf(expected), romajiOf(actual));
  const similarity = Math.max(kanaScore, romajiScore);
  // At least 80% right is a pass — and on a short line, one sound off is
  // a pass too: with three sounds, one miss is arithmetically doomed.
  const distK = distance(aCore, bCore);
  const shortGrace = (aCore.length <= 6 && distK <= 1);
  return { passed: similarity >= 0.8 || shortGrace, similarity: Math.round(similarity * 100) };
}
