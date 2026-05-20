# personal-metrics

은우 개인 작업의 매출 기여 attribution + 1년 후 협상용 객관 데이터 자산.

회사 운영용 cx-report-bot(`report.js`·`collect.js`)과 **분리된 시스템**. 같은 저장소·같은 데이터 소스를 쓰지만 목적·소유·출력이 다름:

| 시스템 | 목적 | 출력 | 소유 |
|---|---|---|---|
| **cx-report-bot** (root) | 회사 운영 CX 도구 (텔레그램 단톡방·DM) | 일간/주간 리포트 | 회사 |
| **personal-metrics** (이 폴더) | 은우 개인 작업 attribution + 협상 자산 | 비공개 시트 + 내부 대시보드 + 외부 포트폴리오 | 은우 |

## 데이터 소스 재사용

```js
const ds = require('../lib/datasources');
const meta = await ds.getMetaStats(...);   // report.js 함수 재사용
```

`report.js`가 `module.exports`로 데이터 수집 함수를 노출함. 중복 fetch 없음.

## Phase 1 (현재)

- [x] UTM 가이드 ([UTM-GUIDE.md](UTM-GUIDE.md))
- [x] 활동 로그 시드 ([ACTIVITY-LOG-SEED.md](ACTIVITY-LOG-SEED.md))
- [x] 데이터 함수 재사용 채널 (`lib/datasources.js`)
- [ ] 비공개 스프레드시트 생성 ([SHEET-SETUP.md](SHEET-SETUP.md)) — 은우 본인이 1-2분 작업
- [ ] 활동 로그 입력 시작 (매일 5분)

## Phase 2 (카페24 토큰 회복 후)

- [ ] `sync.js` — 일일 GA4·Meta·Clarity·Cafe24 → 시트 자동 sync
- [ ] 신규 GitHub Actions 워크플로우 (telegram 안 보냄, cron 가능)

## Phase 3 — 분석·출력

- [ ] `case-analyzer.js` — Before/After 통계검정 (chi-square, t-test)
- [ ] `utm.js` — UTM URL + QR 자동 생성
- [ ] `build-html.js` — 시트 → 내부 dashboard / 외부 portfolio HTML (visibility 필터)

## 핵심 규칙

1. **GA4 구매전환:** `ecommercePurchases` 만 사용. `conversions`/`keyEvents` 금지 (CVR 100% 초과 오류)
2. **카페24 토큰:** VPS 파일 읽기만, 갱신 로직 작성 금지
3. **자사몰 테마 수정:** SFTP→API PUT→백업→검증 표준 흐름만
4. **외부 포트폴리오:** 절대값 마스킹, `visibility=public` 행만 노출
