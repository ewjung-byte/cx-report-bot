# UTM 표준 가이드 (이태리정미소 개인 성과 측정)

> 모든 콘텐츠·인쇄물에 일관된 UTM을 붙여 본인 작업의 매출 기여를 attribution 한다.
> 일관성 없는 UTM = 측정 불가 = 협상 카드 없음.

---

## 1. UTM 구조 (필수 5개)

| 파라미터 | 필수? | 값 규칙 | 예시 |
|---|---|---|---|
| `utm_source` | ✅ | 소문자, 매체명만 | `instagram` · `blog` · `newsletter` · `kakao` · `naver` · `print_box` · `print_card` |
| `utm_medium` | ✅ | 소문자, 채널 유형 | `organic` · `paid` · `email` · `sms` · `referral` · `qr` |
| `utm_campaign` | ✅ | 소문자-하이픈, `<주제>-<시즌/이슈>` | `lungo-launch` · `pesto-summer-2026` · `evoo-paparella` |
| `utm_content` | ✅ | 소문자-하이픈, **콘텐츠 단위 unique** | `ig-reel-12` · `blog-post-43` · `box-insert-v2` |
| `utm_term` | 선택 | 검색광고 키워드만 | `바질페스토` |

**왜 utm_content 필수:** 같은 캠페인 안에서도 어느 콘텐츠가 매출을 만들었는지 분리해야 본인 작업 기여를 잴 수 있음.

---

## 2. 작명 규칙

### 2.1 소스(source)별 표기

| 매체 | utm_source 값 | 비고 |
|---|---|---|
| 인스타그램 | `instagram` | 릴/포스트/스토리 모두 |
| 네이버 블로그 | `naver_blog` | |
| 네이버 검색광고 | `naver_search` | |
| 카카오톡 채널 | `kakao_channel` | |
| 뉴스레터 | `newsletter` | |
| 단박스 인서트 | `print_box` | |
| 명함 | `print_card` | |
| 전단지 | `print_flyer` | |
| 행사 부스 | `event_<행사명>` | 예: `event_hyundai-popup` |
| 패키지 QR | `print_package_<SKU>` | 예: `print_package_pesto` |

### 2.2 캠페인(campaign) 작명

`<제품·테마>-<시즌·이슈>` 형태, 영문 소문자-하이픈.

- ✅ `lungo-launch` · `pesto-summer-2026` · `evoo-paparella-detail` · `popup-hyundai-may`
- ❌ `Lungo Launch` (대문자/공백) · `런칭` (한글) · `camp1` (의미없음)

### 2.3 콘텐츠(content) 작명

콘텐츠 단위로 unique. 같은 캠페인이라도 릴 #12와 #13은 다른 utm_content.

- 인스타 릴: `ig-reel-<번호>`
- 인스타 포스트: `ig-post-<날짜>` (예: `ig-post-20260520`)
- 블로그: `blog-<제목축약>` (예: `blog-pesto-recipe`)
- 인쇄물 버전: `<인쇄물타입>-v<버전>` (예: `box-insert-v2`)

---

## 3. URL 생성 워크플로우

1. **목적지 URL** 결정 (예: `https://italy-jungmiso.com/product/detail.html?product_no=27`)
2. **UTM 5개 파라미터** 작명 (위 규칙대로)
3. **풀 URL 생성** → UTM Library 시트(Sheet 5)에 등록
4. (인쇄물·QR이 필요한 경우) **short URL + QR 이미지** 생성, Drive 업로드, 시트에 링크 등록

### 풀 URL 예시

```
https://italy-jungmiso.com/product/detail.html?product_no=27
  ?utm_source=instagram
  &utm_medium=organic
  &utm_campaign=lungo-launch
  &utm_content=ig-reel-12
```

(`?`는 첫 파라미터에만, 그 다음은 `&`)

---

## 4. 인쇄물 attribution (단박스·패키지·명함)

**핵심:** 종이는 클릭 추적이 안 되므로 **QR + 짧은 URL**로 우회.

| 인쇄물 | utm_source | utm_medium | 필수 |
|---|---|---|---|
| 단박스 인서트 | `print_box` | `qr` | QR 이미지, short URL |
| 명함 | `print_card` | `qr` 또는 `referral` | 본인 명함은 `referral` |
| 패키지 라벨 | `print_package_<SKU>` | `qr` | SKU별로 다른 source |
| 전단지 | `print_flyer` | `qr` | 행사별로 캠페인 분리 |
| 팝업 부스 | `event_<행사>` | `qr` | 행사명 명시 |

**short URL:** 인쇄물에 긴 UTM URL 직접 노출 불가 → 단축 URL 서비스 또는 우리 자사 redirect 페이지 운영. 일단 [bit.ly](https://bit.ly) 무료 플랜으로 시작 가능.

**QR 생성:** Node.js `qrcode` 패키지 또는 `qr-server.com` 무료 API.

---

## 5. UTM Library 시트 입력 항목 (Sheet 5)

| 컬럼 | 예시 |
|---|---|
| `utm_id` | UUID 또는 `2026-05-20-001` |
| `created_date` | `2026-05-20` |
| `destination_url` | `https://italy-jungmiso.com/product/detail.html?product_no=27` |
| `utm_source` | `instagram` |
| `utm_medium` | `organic` |
| `utm_campaign` | `lungo-launch` |
| `utm_content` | `ig-reel-12` |
| `utm_term` | (빈칸) |
| `full_url` | (자동 조합된 풀 URL) |
| `qr_image_url` | Drive 링크 (인쇄물용일 때만) |
| `usage_context` | "5/22 인스타 릴 발행, 룽고 출시 캠페인" |

---

## 6. 측정 가능 vs 측정 불가

**✅ 측정 가능 (UTM 붙은 채널):**
- 인스타그램 (utm 붙여 링크 게시)
- 블로그·뉴스레터·카카오톡
- QR 코드(인쇄물)
- 본인 콘텐츠로 들어온 트래픽

**❌ 측정 불가 (자연 발견):**
- 직접 입력(Direct) · 북마크
- 검색 → 클릭 (utm 없는 organic search)
- 입소문·구두 전달

**대응:** "측정 불가 자연유입 비중"을 일일 KPI 시트(Sheet 2)에 컬럼으로 추적 → 측정 불가 비중이 너무 크면 UTM 누락 또는 도구 문제.

---

## 7. Do / Don't

✅ 한 콘텐츠 = 한 utm_content (재사용 금지)  
✅ 캠페인 작명은 발행 전 미리 정해두기  
✅ 단축 URL이라도 utm은 그대로 보존  
✅ 매주 UTM Library 시트에 누적 기록  

❌ 대문자·공백·한글 (URL encoding 깨짐)  
❌ "test" · "camp1" 등 의미없는 값  
❌ utm 없는 채로 인쇄물 발행  
❌ 같은 utm_content를 여러 콘텐츠가 공유

---

## 8. 분석 시 핵심 질문

매주 시트 보면서 던질 질문:

1. **어느 source가 매출 만드는가** — `utm_source` 별 매출/세션 비교
2. **어느 콘텐츠가 가장 효율적인가** — `utm_content` 별 CR (방문 대비 구매)
3. **인쇄물은 살아있는가** — `print_*` 매출 기여, 본전(인쇄비) 회수율
4. **새 캠페인 vs 기존 캠페인** — 캠페인별 성과 비교
5. **측정 누락 비중** — 전체 매출 중 utm 추적 가능 비중

이 질문들에 답할 수 있게 데이터를 일관되게 쌓는 게 본 가이드의 목적.
