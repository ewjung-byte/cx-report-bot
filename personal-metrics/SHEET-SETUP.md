# 비공개 스프레드시트 생성 가이드

> Phase 1 첫 작업. 1-2분 소요. 은우 본인만 접근 가능한 스프레드시트 + 6시트 schema.

---

## 1단계: 신규 스프레드시트 생성

1. 브라우저에서 [sheets.new](https://sheets.new) 접속
2. 새 스프레드시트가 열리면 좌상단 제목 클릭 → **`이태리정미소 — 은우 개인 성과 측정`** 으로 변경
3. 좌상단 **공유** 버튼 클릭 → **"제한됨"** 으로 두기 (나만 보기). 절대 링크 공유 X
4. 주소창에서 **스프레드시트 ID** 복사 (URL에서 `/d/` 와 `/edit` 사이 긴 문자열). 형태:  
   `https://docs.google.com/spreadsheets/d/`**`<여기가 ID, 44자 정도>`**`/edit`
5. **그 ID를 저한테 알려주세요** — 이후 sync 코드가 이 시트를 쓰게 됩니다

---

## 2단계: 6시트 생성 (스프레드시트 안에서)

기본 "시트1"을 삭제하지 말고 이름만 바꿔서 6개를 만듭니다. 좌하단 `+` 버튼으로 시트 추가.

각 시트는 **이름**과 **헤더 1행**을 정확히 아래대로:

### Sheet 1 — `활동로그`
헤더 1행 (A1부터 한 줄):
```
date	category	title	target_url	description	intent	before_screenshot	after_screenshot	linked_case_id	status	visibility
```
(탭으로 구분, 그대로 복사해서 A1에 붙여넣으면 자동으로 11개 열로 분리됨)

### Sheet 2 — `일일KPI`
```
date	total_sessions	purchases	conversion_rate	aov	add_to_cart_rate	checkout_completion_rate	new_users	returning_users	avg_session_duration	total_revenue	metric_source
```
*`purchases`는 GA4 `ecommercePurchases` 메트릭. `conversions` 절대 안 씀 (CVR 100% 초과 오류 방지).*

### Sheet 3 — `페이지별성과`
```
page_url	period	sessions	conversion_rate	aov	avg_time_on_page	scroll_depth	bounce_rate	sync_date
```

### Sheet 4 — `Cases`
```
case_id	change_date	target	description	metric_focus	before_value	after_value	pct_change	p_value	revenue_impact_estimate	external_factors_notes	metric_source	visibility
```

### Sheet 5 — `UTM`
```
utm_id	created_date	destination_url	utm_source	utm_medium	utm_campaign	utm_content	utm_term	full_url	qr_image_url	usage_context
```

### Sheet 6 — `월간요약`
```
month	changes_total	changes_상페	changes_패키지	changes_인쇄	changes_콘텐츠	changes_CX	cumulative_revenue_impact_est	top_3_case_ids	bottom_3_case_ids
```

---

## 3단계: 활동 로그 시드 입력

`personal-metrics/ACTIVITY-LOG-SEED.md` 의 시드 행 9개를 `활동로그` 시트 2행 이하에 붙여넣기. 본인 작업과 다른 부분은 수정·삭제.

---

## 4단계 (저한테 알려주실 것)

- 스프레드시트 **ID** (URL에서 추출, 44자 안팎)
- 시트 6개 생성 + 헤더 완료 여부

ID 알려주시면 메모리에 기록하고, 카페24 토큰 회복 후 sync 코드 작성·연결하겠습니다.

---

## 왜 비공개 유지

- 절대 매출 / 카페24 raw / 메타 광고비 / 원가·마진은 외부 공개 금지 (협상 안전성·계약 조건)
- 외부 포트폴리오는 별도 빌드 스크립트가 `visibility=public` 행만 추출 + 절대값 마스킹해서 HTML 생성. 시트 자체를 공유하면 안 됨
