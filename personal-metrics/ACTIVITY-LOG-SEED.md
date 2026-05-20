# 활동 로그 시드 (Activity Log 초기 입력안)

> 스프레드시트 Sheet 1 (활동 로그) 생성 후 아래 행을 그대로 복붙(붙여넣기) 가능.
> 메모리 기록·최근 작업 기준 초안. 추가·수정해서 본인 실제 작업과 정확히 맞춰주세요.

---

## 컬럼 순서

`date | category | title | target_url | description | intent | before_screenshot | after_screenshot | linked_case_id | status | visibility`

## 시드 행 (필요시 수정·삭제)

| date | category | title | target_url | description | intent | before_screenshot | after_screenshot | linked_case_id | status | visibility |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-05-08 | 상페 | 룽고 상세페이지 가이드 HTML 제작 | https://lungo-ref.vercel.app | 파네 룽고 촬영 가이드, 카피 원칙 5원칙 적용, 정미소 톤 회귀 | 광고톤 → 정미소 톤 정렬, 일관된 톤으로 신뢰도 회복 | | | | shipped | public |
| 2026-05-12 | 상페 | 파파렐라 EVOO 상세페이지 (룽고 엔진 이식) | (paparella netlify) | 룽고 가이드 구조·CSS 이식, 공식 사실검증 통과 항목만 노출, 미검증 4종 보류 | 검증된 사실만 표기해 클레임·반품 리스크 차단 | | | | shipped | public |
| 2026-05-13 | 인쇄 | OPP 인쇄테이프 디자인안 (단박스 브랜딩) | | 아이스박스용 70M 역방향 인쇄 스펙, 디스크립터 후보 시안 | 패키지 인지·언박싱 경험 강화, 단박스 통일성 | | | | in_progress | public |
| 2026-05-15 | CX | 카카오 웰컴 메시지 확정 | | 채널 친구 추가 시 발송 카피·이미지 확정 | 신규 가입 직후 첫 접점에서 브랜드 톤 일관성 + 첫구매 유도 | | | | shipped | public |
| 2026-05-15 | 상페 | 자사몰 product_detail 구매하기 버튼 일원화 | https://italy-jungmiso.com | 중복된 구매하기 2번 노출 제거 + 옵션 노출 + 여백 줄이기 | 결제 진입 마찰 감소, 모바일 첫 화면 정보밀도 향상 | | | | in_progress | public |
| 2026-05-17 | 콘텐츠 | 룽고 카피 원칙 5원칙 확정 | | 광고톤→정미소 톤 회귀, 섹션별 확정 After 카피 | 향후 모든 상페·콘텐츠 톤 단일 기준 | | | | shipped | public |
| 2026-05-18 | CX | CX 리포트 봇 A안 결정 (메타·매출 제거, 행동·재구매 중심) | | 송마망 봇 중복 회피, 은우봇은 CX 행동·요약 전담 | 봇 간 역할 분리로 단톡방 노이즈 제거, OKR 재구매 추적 가능화 | | | | shipped | internal_only |
| 2026-05-19 | CX | 시트 기록·태그·요약 시스템 전면 수정 (GAS v8) | | 토큰 매칭·일일대화 저장·완료=행삭제·텍스트서식 강제 | 단톡방 의사결정·VOC 누락 방지 (시스템 핵심 목적) | | | | shipped | internal_only |
| 2026-05-20 | CX | GA4 전환 중복집계 버그 수정 (ecommercePurchases) | | conversions 메트릭 키이벤트 합계 오류 → 실제 구매만 측정 | 주간 리포트 CVR 신뢰성 회복, 재방문 CVR 4.3% vs 신규 0.8% 인사이트 확보 | | | | shipped | internal_only |

---

## category 값 (enum 고정)

`상페` · `패키지` · `인쇄` · `콘텐츠` · `CX`

## status 값 (enum 고정)

`in_progress` · `shipped` · `archived`

## visibility 값 (enum 고정)

`public` (외부 포트폴리오 노출 가능) · `internal_only` (절대값/사내정보 포함, 외부 비노출)

## 입력 습관 (매일 5분)

- **그날 끝낸 것**: shipped로 등록
- **시작한 것**: in_progress로 등록 (완료 시 status만 변경)
- **의도(intent)** 필수 — 나중에 협상·포트폴리오에서 "왜 이걸 했나"의 근거
- **before/after 스크린샷**: Drive 업로드 후 링크. 시각적 변화는 외부 포트폴리오의 핵심
- **linked_case_id**: 통계검정 대상이면 Sheet 4(Cases)의 case_id 적기

추후: 1주~1개월 후 매출 변화 측정 가능한 항목은 Sheet 4(Before/After Cases)로 승격.
