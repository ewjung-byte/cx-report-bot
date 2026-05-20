// 공용 데이터 수집 함수 진입점.
// 현재는 report.js의 export를 그대로 재노출 (분리 리팩토링은 추후 진행).
// personal-metrics 스크립트는 항상 이 경로를 통해 require 한다 — report.js 직접 import 금지.
// 이후 functions을 lib/로 옮기더라도 personal-metrics는 경로 변경 없이 그대로 동작.

module.exports = require('../report.js');
