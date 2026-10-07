// pickClimate: 2026-10-07 마카오는 1순위 지역 좌표가 바다 격자를 읽었고(일교차 1.5도),
// 다른 좌표를 시도하는 길도, 거절하는 길도 없었다. 네트워크 없이 그 두 길을 잰다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickClimate } from './refresh-country-facts.mjs';

const mk = (his, los) => his.map((hi, i) => ({ m: i + 1, hi, lo: los[i], rain: 100 }));
const SEA = mk([19, 19, 21, 24, 27, 29, 30, 30, 30, 28, 24, 20],
               [17, 17, 20, 23, 26, 28, 29, 29, 28, 26, 22, 18]);
const LAND = mk([20, 21, 24, 27, 29, 30, 31, 30, 30, 28, 25, 21],
                [13, 14, 18, 21, 24, 27, 27, 27, 26, 23, 19, 14]);

test('1순위가 바다면 다음 격자의 좌표로 넘어가고, 그 지역 이름을 단다', async () => {
  const calls = [];
  const fetchFake = async (lat) => { calls.push(lat); return lat < 22.3 ? SEA : LAND; };
  const r = await pickClimate('X', [
    { city: 'Seaside', lat: 22.15, lng: 113.55 },
    { city: 'Inland', lat: 22.8, lng: 113.55 },
  ], fetchFake);
  assert.equal(r.pt.city, 'Inland');
  assert.equal(r.months, LAND);
  assert.equal(r.tried.length, 1);
  assert.match(r.tried[0].issues[0], /바다 격자/);
});

test('어느 좌표도 통과 못 하면 기후를 내지 않는다 (덜 나쁜 값으로 채우지 않는다)', async () => {
  const r = await pickClimate('Macau', [
    { city: 'Taipa Village', lat: 22.15, lng: 113.557 },
    { city: 'Inner Harbour', lat: 22.6, lng: 113.557 },
  ], async () => SEA);
  assert.equal(r.pt, null);
  assert.equal(r.months, null);
  assert.equal(r.tried.length, 2);
});

test('같은 격자에 떨어지는 좌표는 다시 묻지 않는다', async () => {
  let n = 0;
  const r = await pickClimate('Macau', [
    { city: 'Taipa', lat: 22.1535, lng: 113.557 },
    { city: 'Coloane', lat: 22.1227, lng: 113.5633 },
    { city: 'Barra', lat: 22.1884, lng: 113.535 },
  ], async () => { n += 1; return SEA; });
  assert.equal(n, 1);
  assert.equal(r.pt, null);
});

test('1순위가 멀쩡하면 거기서 멈춘다 (역방향)', async () => {
  let n = 0;
  const r = await pickClimate('Hong Kong', [
    { city: 'Hong Kong', lat: 22.28, lng: 114.15 },
    { city: 'Lantau', lat: 22.25, lng: 113.9 },
  ], async () => { n += 1; return LAND; });
  assert.equal(r.pt.city, 'Hong Kong');
  assert.equal(n, 1);
});
