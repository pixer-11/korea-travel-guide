## 결론

코드만으로 Google의 내부 판정을 증명할 수는 없다. 정확히 어떤 분류기가 7월 25일 작동했는지는 **모른다**.

다만 저장소에서 관측되는 가장 강한 기여 요인은 다음 순서다.

1. **같은 제목·설명·분량·섹션 골격을 가진 글을 도시별로 대량 생산하고, 그 골격을 4개 언어로 그대로 증폭한 것**
2. **내용이 충분하지 않은 지역 허브까지 한 글만 있으면 5개 언어로 생성하는 것**
3. **7월 29일 추가된 when-to-go 도구의 대규모 유사 페이지군**. 최초 급락 원인은 될 수 없지만, tools -92%와 이후 회복 부진에는 기여했을 가능성이 높다.
4. **도구·이벤트 URL에 실제 변경과 무관한 `lastmod`를 계속 보내는 것**
5. **일부 구조화 데이터가 화면의 실제 엔티티보다 거칠거나 부정확한 것**

반대로 canonical, hreflang, robots, 현재 내부 링크, 색인 허용 상태는 정상이다. 여기서 원인을 찾으면 안 된다.

계량 모수는 현재 체크아웃에서 실제 라우트가 생성하는 `draft:false` 영어 글 1,349편이다. 운영상의 1,481편 수치를 재검증한 것이 아니라, [`src/pages/posts/[...slug].astro:8`](</C:/Users/user/wa-main/src/pages/posts/[...slug].astro:8>)의 현재 생성 조건을 적용했다.

---

## 1. 가장 큰 신호: 사이트 전체가 같은 생산 라인에서 나온다

**확신: 가장 강한 저장소 내부 추정**

### (a) 근거

제목은 [`scripts/lib/titles.mjs:43`](</C:/Users/user/wa-main/scripts/lib/titles.mjs:43>)에서 거의 결정적으로 다음 형태로 만들어진다.

- 장소: `장소명: 지역 Travel Guide`
- 식당: `장소명: Where to Eat in 지역`
- 조건 충족 시 끝에 별점 추가: [`titles.mjs:57-65`](</C:/Users/user/wa-main/scripts/lib/titles.mjs:57>)

현재 1,349편 전수 결과:

- 콜론 포함: 1,305편, **96.7%**
- `Travel Guide` 포함: 1,047편, **77.6%**
- 별점 접미사: 621편, **46.0%**
- attraction 제목의 `Travel Guide`: **99.1%**
- hidden-gem: **98.1%**
- trendy: **85.3%**

이는 사용자가 실측한 60편 표본의 98%/80%/48%와 사실상 일치한다.

설명도 개별 문자열 자체는 중복되지 않지만, 669편, **49.6%**가 정확히 같은 문장 뼈대로 끝난다.

> `4.x★ (... reviews) — what visitors say, hours, and tips.`

이 문장은 [`scripts/lib/serp.mjs:62-70`](</C:/Users/user/wa-main/scripts/lib/serp.mjs:62>)에서 고정 생성된다. 평점 자체는 저장된 Google Places 값만 사용하며 최소 4.0·100리뷰 조건도 있으므로 가짜 평점은 아니다. 근거는 [`serp.mjs:37-45`](</C:/Users/user/wa-main/scripts/lib/serp.mjs:37>)다.

본문도 H2 제목 조합은 다양하지만 골격은 균일하다.

- 839개의 서로 다른 H2 조합: 사용자의 “40편 모두 다른 H2” 관찰과 모순되지 않음
- 전체의 **98.4%가 H2 5개 또는 6개**
- **80.3%가 616∼756단어**
- 846편, **62.7%**가 첫 H2로 `Why go` 사용
- 878편에는 같은 AI 공개문이 본문에 그대로 남아 있음: 예시 [`agra-taj-mahal.md:73`](</C:/Users/user/wa-main/src/content/posts/agra-taj-mahal.md:73>)
- 그런데 컴포넌트도 별도 공개문을 추가함: [`PostArticle.astro:836-842`](</C:/Users/user/wa-main/src/components/PostArticle.astro:836>). 따라서 878개 페이지에는 같은 공개문이 두 번 나타난다.

생성기는 24개 장소 유형 템플릿을 모든 국가·도시에 반복 적용한다. [`scripts/generate.mjs:202-225`](</C:/Users/user/wa-main/scripts/generate.mjs:202>), [`scripts/generate.mjs:546-552`](</C:/Users/user/wa-main/scripts/generate.mjs:546>).

번역기는 문장 자체는 재작성하도록 요구하지만 H2·목록·링크 구조는 정확히 보존한다. [`scripts/translate-posts.mjs:116-145`](</C:/Users/user/wa-main/scripts/translate-posts.mjs:116>). 영어 골격 하나가 5개 URL로 증폭되는 구조다.

### (b) 문제

각 페이지가 중복 문서는 아니지만, 제목 문법·설명 끝문장·글 길이·H2 개수·공개문·도시별 토픽 배치가 통계적으로 지나치게 균일하다. 개별 페이지 중복 검사보다 사이트 단위 패턴에서 훨씬 잘 드러난다.

### (c) 검색어 축소와의 연결

색인은 유지되면서 긴 꼬리 질의에서만 대량 퇴장하고 평균순위가 좋아진 현상과 가장 잘 맞는다. 강한 브랜드·장소명 질의만 남고, Google이 사이트 전체의 확장형 콘텐츠에 부여하던 주변 질의 자격을 줄이면 이런 생존편향이 생긴다.

단, 이것이 실제 Google 판정이었다는 직접 증거는 없으므로 **인과는 추정**이다.

현재 프롬프트는 이 문제를 이미 인식해 2026-08-28부터 세 가지 분량 형태를 도입했다. [`scripts/lib/writer.mjs:152-170`](</C:/Users/user/wa-main/scripts/lib/writer.mjs:152>). 하지만 기존 1,349편에는 소급 적용되지 않았다.

### (d) 수정 1줄

기존 상위 가치 페이지부터 제목·설명·본문 길이·섹션 수를 카테고리별로 재편집하고, 878편의 본문 내 중복 공개문을 제거하라.

---

## 2. when-to-go는 최초 원인은 아니지만 tools -92%의 가장 강한 코드 설명이다

**확신: 최초 급락 원인은 아님. 이후 악화·회복 부진 기여는 중간 이상 추정**

### (a) 근거

이 기능은 Git 이력상 **2026-07-29**, 커밋 `3bc7f202`에서 1,025페이지로 출시됐다. 따라서 7월 25일 최초 급락보다 늦다.

과거 구현은 월별 형제 페이지끼리 72∼86%가 같았으며, 코드 주석도 이를 “doorway set”으로 기록한다. [`WhenToGoPage.astro:128-137`](</C:/Users/user/wa-main/src/components/WhenToGoPage.astro:128>).

현재도:

- 20개 국가 × 12개월 = 영어 월 페이지 240개
- 국가 부모·인덱스·5개 언어까지 합치면 **1,305개 URL**
- 영어 월 페이지 240개 중 44개는 고유 휴일과 이벤트가 모두 없음
- 166개는 이벤트가 없음

콘텐츠 연결도 늦었다. 국가 허브에서 when-to-go 부모로 가는 최초 문맥 링크가 8월 28일 추가됐다고 코드가 명시한다. [`DestinationHub.astro:223-230`](</C:/Users/user/wa-main/src/components/DestinationHub.astro:223>).

### (b) 문제

현재 중복률은 8월 7일 수정으로 크게 줄었지만, 고유 이벤트·휴일이 없는 월 페이지는 여전히 국가명·월명·기후 수치만 바뀌는 얇은 프로그램형 문서다. 출시 초기에 대규모 유사 URL이 한꺼번에 노출됐고, 한동안 허브의 문맥 링크도 거의 없었다.

### (c) 검색어 축소와의 연결

7월 25일 최초 급락은 설명하지 못한다. 시간 순서상 배제해야 한다.

하지만 tools -92%는 설명할 수 있다. 도구군이 가장 큰 낙폭을 보인 것은 “고아라서”라기보다, 해당 유형이 짧은 기간에 가장 큰 유사 URL 묶음으로 확대됐기 때문일 가능성이 높다. Google이 수정된 문서를 다시 평가하는 데 시간이 걸린다는 부분은 **추정**이다.

### (d) 수정 1줄

고유 이벤트·휴일·월별 행동 정보가 일정 기준에 못 미치는 월 URL은 국가 부모 페이지에 통합하거나 충족 시점까지 `noindex`·사이트맵 제외하라.

---

## 3. 지역 허브는 한 글만 있어도 5개 언어로 생성된다

**확신: 지역 -88%와의 연결은 중간 이상 추정**

### (a) 근거

영어 지역 허브 생성 조건은 “발행 글이 하나라도 있는 지역”이다. [`src/pages/regions/[region].astro:6-18`](</C:/Users/user/wa-main/src/pages/regions/[region].astro:6>).

로컬라이즈 라우트는 그 모든 지역을 4개 언어로 추가 생성한다. [`src/pages/[lang]/regions/[region].astro:7-22`](</C:/Users/user/wa-main/src/pages/[lang]/regions/[region].astro:7>).

현재 314개 지역 중:

- 46개, **14.6%**: 글 1개
- 143개, **45.5%**: 글 2개 이하
- 179개, **57.0%**: 글 3개 이하
- 중앙값: 글 3개

글 2개 이하 지역만 5개 언어로 계산하면 715개 허브 URL이다.

제목은 모두 `{지역} Travel Guide`다. [`RegionHub.astro:156`](</C:/Users/user/wa-main/src/components/RegionHub.astro:156>).

### (b) 문제

소개문·FAQ는 지역별로 준비돼 있어 빈 페이지는 아니고, 현재 지역 번역 데이터도 완비돼 있다. 잘못된 hreflang 페이지도 아니다.

그러나 `Seoul Travel Guide`와 동일한 검색 의도를 표방하면서 실제 목록이 장소 한두 개뿐인 지역 허브가 절반에 가깝다. 페이지의 약속과 인벤토리 깊이가 맞지 않는다.

### (c) 검색어 축소와의 연결

`[도시] travel guide`, `[도시] things to do`, `[도시] attractions` 같은 넓은 질의에서 한두 개 장소만 가진 허브가 주변 질의를 잃는 것은 지역 -88%와 방향이 맞는다. 다만 코드만으로 Google이 이를 원인으로 삼았는지는 증명할 수 없다.

### (d) 수정 1줄

지역 허브 색인 기준을 최소 4개 이상의 서로 다른 실질 콘텐츠로 올리고, 기준 미달 허브는 완성 전까지 사이트맵 제외와 `noindex`를 적용하라.

---

## 4. 사이트맵 `lastmod`가 실제 페이지 변경을 과장한다

**확신: 코드 결함은 확실, 검색어 축소와의 연결은 약함**

### (a) 근거

모든 일반 글이 발행·수정될 때 해당 국가의:

- 이벤트 허브를 갱신한 것으로 처리: [`astro.config.mjs:127`](</C:/Users/user/wa-main/astro.config.mjs:127>)
- 12개 when-to-go 월 페이지 전부를 갱신한 것으로 처리: [`astro.config.mjs:128-130`](</C:/Users/user/wa-main/astro.config.mjs:128>)

그러나 월 페이지에서는 이미 국가 전체 장소 목록을 제거했다. [`WhenToGoPage.astro:128-137`](</C:/Users/user/wa-main/src/components/WhenToGoPage.astro:128>). 일반 식당 글이 추가돼도 12개 월 페이지의 실제 HTML은 변하지 않는다.

### (b) 문제

코드 주석은 `lastmod`가 실제 변경일이라고 주장하지만 [`astro.config.mjs:86-89`](</C:/Users/user/wa-main/astro.config.mjs:86>), 실제 구현은 관련 없는 글 발행으로 수십 개 도구·이벤트 URL의 날짜를 새로 만든다.

### (c) 검색어 축소와의 연결

직접적인 순위 하락 원인이라고 말하기는 어렵다. 연결은 **약하다**. 다만 대량 사이트에서 잘못된 freshness 신호는 재크롤 우선순위를 낭비하고 사이트맵 날짜의 신뢰도를 낮출 수 있다.

### (d) 수정 1줄

월별 기후·휴일·이벤트 데이터가 바뀐 월만 갱신하고, 이벤트 허브는 실제 이벤트 글이 변경됐을 때만 `lastmod`를 올려라.

---

## 5. 구조화 데이터는 대체로 정직하지만 엔티티 정밀도가 떨어지는 곳이 있다

**확신: 결함 확실, 사이트 전체 검색어 축소와의 연결은 약함∼중간**

### 행사 장소

저장 데이터에는 `eventVenue`가 있다. [`src/content.config.ts:65`](</C:/Users/user/wa-main/src/content.config.ts:65>). 예를 들어 US Grand Prix 글에는 `Circuit of the Americas`가 저장돼 있다. [`austin-formula-1-united-states-grand-prix.md:49`](</C:/Users/user/wa-main/src/content/posts/austin-formula-1-united-states-grand-prix.md:49>).

하지만 Event JSON-LD는 이를 무시하고 장소명과 주소를 모두 `Austin`으로 출력한다. [`PostArticle.astro:459-463`](</C:/Users/user/wa-main/src/components/PostArticle.astro:459>). 장소·경기장 질의에 필요한 엔티티를 도시로 뭉개는 명백한 손실이다.

또한 로컬라이즈 이벤트 페이지에서도 Event 이름은 영어 원문 제목에서 생성된다. [`PostArticle.astro:441-445`](</C:/Users/user/wa-main/src/components/PostArticle.astro:441>). 한국어 H1과 JSON-LD 이름이 서로 다르다.

### 도구 Dataset

월 페이지는 한 달만 보여주지만 매 페이지가 `{country} climate normals by month` 전체 Dataset을 주장한다. [`WhenToGoPage.astro:73-95`](</C:/Users/user/wa-main/src/components/WhenToGoPage.astro:73>). 전체 12개월 표가 부모로 이동한 현재 구조와 맞지 않는다.

### 타입 분류

모든 trendy 장소는 `TouristAttraction`, 모든 hidden-gem은 `LocalBusiness`다. [`PostArticle.astro:224-230`](</C:/Users/user/wa-main/src/components/PostArticle.astro:224>). 공원·서점·시장·카페를 이 두 타입으로 단정하면 엔티티 이해가 거칠어진다.

### 잘 되어 있는 부분

- Google Places 평점을 `aggregateRating`으로 가장하지 않는다. [`PostArticle.astro:415-418`](</C:/Users/user/wa-main/src/components/PostArticle.astro:415>)
- 주최자·티켓·공연자는 저장된 경우에만 출력한다. [`PostArticle.astro:466-501`](</C:/Users/user/wa-main/src/components/PostArticle.astro:466>)
- Pixer 저자는 공개된 필명이며 화면에도 byline이 있다. [`BaseLayout.astro:121-140`](</C:/Users/user/wa-main/src/layouts/BaseLayout.astro:121>), [`PostArticle.astro:605-608`](</C:/Users/user/wa-main/src/components/PostArticle.astro:605>)

### 수정 1줄

Event는 저장된 `eventVenue`와 로컬라이즈 이름을 사용하고, Dataset은 12개월 표가 있는 국가 부모에만 두며, 불명확한 장소는 구체 타입 대신 `Place`를 사용하라.

---

## 페이지 유형별 실제 head 출력

현재 빌드 산출물을 직접 파싱한 결과다.

| 유형 | 실제 title / description | 출력 판정 |
|---|---|---|
| 글 | `Taj Mahal: Agra Travel Guide (4.6★) · Wander Atlas` / `The Taj Mahal ... 4.6★ (251,281 reviews) — what visitors say, hours, and tips.` | self-canonical, 5개 언어+x-default, `og:type=article`, 실제 hero |
| 지역 | `Seoul Travel Guide · Wander Atlas` / 지역 고유 소개문 | self-canonical, 5개 언어, 실제 지역 이미지. 제목만 공식적 |
| 도구 | `Best Time to Visit — Crowd Finder \| Wander Atlas` / 고유 설명 | 정상. 기본 OG 이미지 |
| 월 도구 | `Japan in March: Weather, Crowds & What's On · Wander Atlas` / 월 도구 템플릿 설명 | 정상 head, 본문·Dataset 깊이가 문제 |
| eSIM | `Japan eSIM for Travelers — eSIM vs Pocket WiFi vs Roaming` / 국가명 치환 설명 | 정상 head, 기본 OG 이미지 |
| 이벤트 허브 | `Upcoming events in Japan · Wander Atlas` / `Upcoming events in Japan` | title과 description이 사실상 동일. [`EventsCountryHub.astro:92-95`](</C:/Users/user/wa-main/src/components/EventsCountryHub.astro:92>) |
| 이벤트 글 | `Formula 1 United States Grand Prix: Dates, Tickets & Venue (Austin)` | head 정상, Event location JSON-LD가 부정확 |
| 일정 | `Seoul in 3 Days: Hanok Villages, Palaces, Markets & Riverside Parks` / 고유 설명 | head 정상. `og:type=website`와 기본 OG 이미지라 검색보다는 공유 품질 문제 |

공통 head 생성은 [`BaseLayout.astro:240-266`](</C:/Users/user/wa-main/src/layouts/BaseLayout.astro:240>)에 있다.

---

## hreflang·canonical: 원인 아님

현재 빌드의 사이트맵 URL 10,972개를 전수 대조했다.

- canonical 불일치: **0**
- self hreflang 누락: **0**
- alternate 대상 파일 누락: **0**
- 상호 참조 오류: **0**
- `<html lang>` 불일치: **0**
- 10,970개가 `en/ko/ja/es/zh-Hans/x-default` 6개 링크 보유
- `/api/`, `/tools/widget/`만 의도적으로 영어 전용

canonical은 현재 pathname으로 만들고 [`BaseLayout.astro:57`](</C:/Users/user/wa-main/src/layouts/BaseLayout.astro:57>), alternates는 실제 존재하는 언어 목록에서만 만든다. [`BaseLayout.astro:58-72`](</C:/Users/user/wa-main/src/layouts/BaseLayout.astro:58>). 글 라우트도 실제 번역 파일이 있는 경우에만 생성한다. [`src/pages/[lang]/posts/[...slug].astro:9-22`](</C:/Users/user/wa-main/src/pages/[lang]/posts/[...slug].astro:9>).

현재 1,349개 live 글은 네 번역 파일이 모두 존재한다. 지역·일정 데이터도 현재는 전 언어가 채워져 있어 영어 fallback이 실제로 작동하는 페이지가 없었다.

**판정:** 5개 언어 canonical/hreflang 배관은 잘 되어 있으며 검색어 축소 원인으로 볼 근거가 없다.

---

## 내부 링크: 현재 고아 구조가 아니다

현재 빌드의 영어 색인 대상 2,196 URL 그래프를 전수 계산한 결과:

- 글 고아: **0**, 최소 인바운드 2, 중앙값 11
- 지역·라운드업 고아: **0**
- when-to-go 고아: **0**, 국가 월 페이지 중앙 인바운드 14
- eSIM·best-time·일정·이벤트 허브 고아: **0**

글은 breadcrumb로 지역에 연결된다. [`PostArticle.astro:582-593`](</C:/Users/user/wa-main/src/components/PostArticle.astro:582>). 국가 허브는 지역·when-to-go·eSIM으로 연결된다. [`DestinationHub.astro:145-151`](</C:/Users/user/wa-main/src/components/DestinationHub.astro:145>), [`DestinationHub.astro:214-238`](</C:/Users/user/wa-main/src/components/DestinationHub.astro:214>).

앵커는 전부 동일하지 않다. 다만 도구 링크에는 반복이 많다.

- best-time: `Quiet times`, `Compare quiet times across every city`
- eSIM 국가 링크: 동일한 `eSIM data` 카드가 다수
- 월 링크: `March`, `Mar`
- 지역 링크: 대부분 도시명

**판정:** 현재 tools -92%를 “고아 페이지”로 설명하면 틀린다. 과거 when-to-go가 8월 28일까지 문맥 연결이 약했던 사실과, 대규모 유사 URL 규모가 더 타당한 설명이다.

---

## 사이트맵·robots: 차단 문제 없음

- 5개 언어 × 7개 유형 = **35개 자식 사이트맵**
- 현재 총 10,972 URL
- 분할 로직: [`src/lib/sitemap-split.mjs:20-53`](</C:/Users/user/wa-main/src/lib/sitemap-split.mjs:20>)
- 인덱스 생성: [`sitemap-split.mjs:73-80`](</C:/Users/user/wa-main/src/lib/sitemap-split.mjs:73>)
- `sitemap-0.xml`은 Bing 제출 호환 때문에 남겨 두되 인덱스에서는 제외한다. [`sitemap-split.mjs:11-15`](</C:/Users/user/wa-main/src/lib/sitemap-split.mjs:11>)
- `public/robots.txt:1-5`: 전체 허용, 메인·이미지 사이트맵 선언
- `public/_headers:1-39`: 캐시/CORS만 있으며 `X-Robots-Tag` 없음

사이트맵에는 XML hreflang이 없지만 HTML head에 완전한 hreflang이 있으므로 오류가 아니다.

한 가지 진단상 결함은 이벤트 글이 `/posts/` 아래 있으므로 `events` 사이트맵이 아닌 `posts` 그룹에 들어간다는 점이다. [`sitemap-split.mjs:21-27`](</C:/Users/user/wa-main/src/lib/sitemap-split.mjs:21>). 순위 문제라기보다 GSC 유형별 관찰을 흐리는 문제다.

---

## 낮은 영향의 자동생성 지문

- 모든 갤러리 이미지가 같은 `장소명 in 지역, 국가` alt를 공유한다. [`PostArticle.astro:194-208`](</C:/Users/user/wa-main/src/components/PostArticle.astro:194>), [`PostArticle.astro:861-864`](</C:/Users/user/wa-main/src/components/PostArticle.astro:861>). 언어 현지화는 잘됐지만 사진별 묘사가 아니다.
- 현재 live 영어 본문에는 과거 생성분의 em dash가 10,657개 남아 있다. 새 프롬프트는 이를 기계 작성 지문으로 명시적으로 금지한다. [`scripts/lib/writer.mjs:15-18`](</C:/Users/user/wa-main/scripts/lib/writer.mjs:15>)
- 이벤트 국가 허브는 title과 description이 같다. 사이트 전체 원인으로는 약하지만 이벤트 허브의 질의 확장에는 불리하다.

수정은 사진별 실제 피사체 alt 저장, 기존 공개문·문장부호 일괄 재생성이 아닌 우선순위 기반 편집, 이벤트 허브 설명의 국가별 고유화다. 단, 본문 변경은 번역 4개를 재생성하므로 저장소 규칙상 비용 승인을 받은 뒤 별도 배치로 해야 한다.

최종적으로, **우선순위는 기존 글의 사이트 단위 균일성 완화 → 얇은 지역/월 URL 색인 기준 강화 → 잘못된 `lastmod`와 schema 정밀도 수정**이다. canonical·hreflang·robots·속도·현재 고아 링크에 시간을 쓰는 것은 이번 현상과 맞지 않는다.