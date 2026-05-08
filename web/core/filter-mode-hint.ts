// 차단 직후 "흐림 처리 모드 안내" Hint DOM modal.
//
// Chrome / Safari ext 두 entry 가 동일한 다이얼로그를 사용 — browser `confirm()` 으로는 *다시 보지 않기*
// UX 를 못 만들어 자체 DOM modal 을 띄운다. iOS / Android 는 native 다이얼로그를 쓰므로 이 helper 는
// 사용 안 함. 추출 전엔 두 entry 에 80+ 줄이 풀 복사돼 있어 문구/색 변경 시 두 곳을 따로 손대야 했음.
//
// 결과 값:
//   - 'dontShow': 사용자가 "다시 보지 않기" 클릭 → 호출자가 DONT_SHOW_FILTER_HINT_KEY 를 영속 저장
//   - 'confirm':  "확인" 또는 overlay 클릭으로 닫힘

export type FilterModeHintResult = 'dontShow' | 'confirm';

export function showFilterModeHintDialog(): Promise<FilterModeHintResult> {
  return new Promise<FilterModeHintResult>((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;' +
      'display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'background:#1a1a1a;color:#e0e0e0;border-radius:14px;padding:20px;' +
      'max-width:340px;width:90%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.4);';

    const title = document.createElement('p');
    title.textContent = '팁: 흐림 처리 모드';
    title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 10px;';

    const msg = document.createElement('p');
    msg.textContent =
      "차단된 글을 완전히 숨기는 대신 흐리게만 처리할 수도 있어요. 익스텐션 팝업의 '흐림 처리' 토글에서 켤 수 있습니다.";
    msg.style.cssText = 'font-size:14px;margin:0 0 18px;line-height:1.5;color:#bbb;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;';

    const dontBtn = document.createElement('button');
    dontBtn.textContent = '다시 보지 않기';
    dontBtn.style.cssText =
      'flex:1;padding:10px;border:1px solid #444;background:transparent;color:#aaa;' +
      'border-radius:8px;font-size:13px;cursor:pointer;';

    const okBtn = document.createElement('button');
    okBtn.textContent = '확인';
    okBtn.style.cssText =
      'flex:1;padding:10px;border:none;background:#4A6CF7;color:#fff;' +
      'border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';

    function close(result: FilterModeHintResult): void {
      overlay.remove();
      resolve(result);
    }

    dontBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close('dontShow');
    });
    okBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close('confirm');
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close('confirm');
    });

    btnRow.appendChild(dontBtn);
    btnRow.appendChild(okBtn);
    dialog.appendChild(title);
    dialog.appendChild(msg);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}
