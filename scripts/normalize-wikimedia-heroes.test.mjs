// normalize-wikimedia-heroes 회귀 테스트 (URL 판별 부분).
//
// 이 스크립트는 590편의 히어로 주소를 다시 쓴다. 주소 파싱이 한 글자라도 틀리면
// 사진이 통째로 깨지고, 그건 발행 파이프라인에서 가장 눈에 띄는 사고다.
// 실제로 08-04에 썸네일 주소를 손으로 조립했다가 29편 중 28편이 400이었다 —
// 네트워크가 필요한 부분(어떤 썸네일을 렌더할 수 있는가)은 API 에 물어보게
// 바꿨고, 여기서는 네트워크 없이 판정되는 부분만 고정한다.
//
//   node scripts/normalize-wikimedia-heroes.test.mjs
import { isWikimedia, stripQuery, originalFile } from './normalize-wikimedia-heroes.mjs';

const ORIG = 'https://upload.wikimedia.org/wikipedia/commons/8/8c/View_of_Basilica.jpg';
const THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Barcelona_-_Rambla.jpg/1600px-Barcelona_-_Rambla.jpg';
const TRACKED = ORIG + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const eq = (got, want) => (got === want ? null : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

t('위키미디어 주소를 알아본다', () => (isWikimedia(ORIG) ? null : 'not recognised'));
t('다른 호스트는 건드리지 않는다', () =>
  (!isWikimedia('https://fastly.4sqi.net/img/general/original/x.jpg') ? null : 'foursquare misread as wikimedia'));
t('업로드 호스트가 아닌 커먼즈 페이지도 제외', () =>
  (!isWikimedia('https://commons.wikimedia.org/wiki/File:X.jpg') ? null : 'wiki page misread as upload'));

t('추적 쿼리를 떼어낸다', () => eq(stripQuery(TRACKED), ORIG));
t('쿼리가 없으면 그대로 둔다', () => eq(stripQuery(ORIG), ORIG));

t('원본 주소에서 파일명을 뽑는다', () => eq(originalFile(ORIG), 'View_of_Basilica.jpg'));
t('썸네일 주소에서도 원본 파일명을 뽑는다', () => eq(originalFile(THUMB), 'Barcelona_-_Rambla.jpg'));
t('추적 쿼리가 붙어 있어도 파일명은 같다', () => eq(originalFile(TRACKED), 'View_of_Basilica.jpg'));
t('인코딩된 파일명을 망가뜨리지 않는다', () =>
  eq(originalFile('https://upload.wikimedia.org/wikipedia/commons/b/b3/Crosswalk_of_Market_at_Third%2C_SF.jpg'),
     'Crosswalk_of_Market_at_Third%2C_SF.jpg'));
t('모양이 다른 주소에는 null 을 준다', () =>
  eq(originalFile('https://upload.wikimedia.org/wikipedia/commons/oops.jpg'), null));

// 08-04 사고의 핵심: 쿼리를 파일명의 일부로 취급하면 썸네일 주소가 전부 400.
t('쿼리를 파일명에 섞지 않는다', () => {
  const f = originalFile(TRACKED);
  return f && !f.includes('?') && !f.includes('utm_') ? null : `query leaked into filename: ${f}`;
});

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
