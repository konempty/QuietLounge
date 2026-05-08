// 라운지 자체 AI(클린봇) 에 의해 본문이 가려진 게시글에는 차단 버튼을 붙이지 않는다.
// (1) 작성자 정보까지 함께 가려져 personaId 추출이 실패해 안내문만 뜨는데
//     상세 페이지에서도 같은 검열이 적용돼 차단할 방법이 없다.
// (2) 검열 안내 문구 옆에 X 버튼이 따라붙는 게 UI 적으로도 어색하다.
//
// 검출은 두 신호의 AND — false-positive 방지:
//  • 구조 신호: 클린봇 글 컨테이너엔 작성자/썸네일 등 메타 슬롯이 전혀 없다.
//               (사용자가 본문 제목에 "클린봇 ... 감지" 류 문자열을 적어도 본인 작성자
//                정보가 살아있어 [data-slot] 매칭에 걸려 가드가 발동되지 않음)
//  • 텍스트 신호: "클린봇" + "감지" 두 키워드 동시 포함 — 라운지 카피 변경에 관대.
export function isCleanbotFiltered(container: Element | null | undefined): boolean {
  if (!container) return false;
  if (container.querySelector('[data-slot]')) return false;
  const text = container.textContent || '';
  return text.includes('클린봇') && text.includes('감지');
}
