// public/vote.js

const pollCard = document.getElementById('pollCard');
const shortCode = window.location.pathname.split('/').pop();

// 取得或產生穩定的 Voter ID
function getVoterId() {
  let vid = localStorage.getItem('bv_voter_id');
  if (!vid) {
    vid = 'v_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('bv_voter_id', vid);
  }
  return vid;
}

const voterId = getVoterId();
const votedKey = `voted_${shortCode}`;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadPoll() {
  try {
    const res = await fetch(`/api/polls/${shortCode}?voterId=${encodeURIComponent(voterId)}`);
    if (!res.ok) {
      pollCard.innerHTML = '<div class="empty">找不到這個投票，連結可能已失效。</div>';
      return;
    }
    const poll = await res.json();

    // 取得使用者先前在此投票的選取紀錄（後端優先，本地快取為輔）
    let userVotes = poll.userVotes;
    if (!userVotes) {
      const saved = localStorage.getItem(votedKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          userVotes = Array.isArray(parsed) ? parsed : parsed.optionIndices;
        } catch (e) {
          userVotes = null;
        }
      }
    }

    // 1. 若投票已結束
    if (!poll.active) {
      renderResults(poll, '這個投票已經結束，以下是最終開票結果：', userVotes);
      return;
    }

    // 2. 若投票進行中且使用者已投過票，展示目前結果並提供「更換選項」入口
    if (userVotes && userVotes.length > 0) {
      renderResults(poll, '你已經完成投票，以下是目前開票結果：', userVotes);
      return;
    }

    // 3. 尚未投票，展示投票選單
    renderVoteForm(poll);
  } catch (err) {
    pollCard.innerHTML = `<div class="empty">載入發生錯誤：${escapeHtml(err.message)}</div>`;
  }
}

function renderVoteForm(poll, preSelected = [], isEditing = false) {
  const isMulti = Boolean(poll.isMultiple);
  const maxLimit = isMulti ? (poll.maxChoices || 2) : 1;
  let selected = new Set(preSelected);

  const modeBadgeText = isMulti ? `複選 · 最多 ${maxLimit} 票` : '單選 · 限選 1 項';

  pollCard.innerHTML = `
    <div class="poll-mode-header">
      <span class="poll-mode-badge">${modeBadgeText}</span>
      <span class="selection-counter" id="counterText">
        ${isMulti ? `已選 ${selected.size} / ${maxLimit} 票` : '請點選一個選項'}
      </span>
    </div>

    <h1>${escapeHtml(poll.title)}</h1>
    <p class="subtitle">${isEditing ? '請修改你的選項並點選「更新我的投票」' : (isMulti ? `請勾選你支持的選項（最多可選 ${maxLimit} 項）：` : '請點選你支持的選項：')}</p>

    <div id="optionsArea">
      ${poll.options.map(o => {
        const checked = selected.has(o.index);
        return `
          <div class="option-vote ${checked ? 'selected' : ''}" data-index="${o.index}">
            <div class="option-vote-left">
              <div class="custom-indicator ${isMulti ? 'checkbox' : ''}"></div>
              <span>${escapeHtml(o.text)}</span>
            </div>
            ${checked ? '<span style="font-size:12px; color:var(--primary); font-weight:600;">已選取</span>' : ''}
          </div>
        `;
      }).join('')}
    </div>

    <div style="margin-top: 20px;">
      <div style="margin-bottom: 14px;">
        <label for="voterNameInput" style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
          📝 你的暱稱 <span style="color:#ef4444;">*</span>
          <span style="font-size: 11px; font-weight: 400; color: #9ca3af; margin-left: 4px;">（必填，最多 20 個字）</span>
        </label>
        <input
          type="text"
          id="voterNameInput"
          maxlength="20"
          placeholder="請輸入你的暱稱..."
          style="width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1.5px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s;"
        />
        <div style="text-align: right; font-size: 11px; color: #9ca3af; margin-top: 4px;">
          <span id="nameCount">0</span> / 20 字
        </div>
      </div>
      <button class="btn-primary btn-block" id="submitVoteBtn" disabled>
        ${isEditing ? '🔄 確認更新我的投票' : '確認送出投票 ➔'}
      </button>
      ${isEditing ? `
        <button class="btn-secondary btn-block" id="cancelEditBtn" style="margin-top: 8px;">
          取消變更，返回開票結果
        </button>
      ` : ''}
    </div>
  `;

  const submitBtn = document.getElementById('submitVoteBtn');
  const counterText = document.getElementById('counterText');
  const voterNameInput = document.getElementById('voterNameInput');

  function updateUI() {
    pollCard.querySelectorAll('.option-vote').forEach(el => {
      const idx = Number(el.dataset.index);
      const isChecked = selected.has(idx);
      el.classList.toggle('selected', isChecked);
    });

    if (isMulti) {
      counterText.textContent = `已選 ${selected.size} / ${maxLimit} 票`;
      counterText.classList.toggle('full', selected.size === maxLimit);
    }
    // 按鈕：需同時有選項 且 已填暱稱
    submitBtn.disabled = selected.size === 0 || voterNameInput.value.trim() === '';
  }

  // 暱稱輸入即時驗證：有填字才解鎖按鈕；同時更新字數計數
  voterNameInput.addEventListener('input', () => {
    document.getElementById('nameCount').textContent = voterNameInput.value.length;
    updateUI();
  });
  voterNameInput.addEventListener('focus', () => { voterNameInput.style.borderColor = '#6366f1'; });
  voterNameInput.addEventListener('blur', () => { voterNameInput.style.borderColor = '#d1d5db'; });

  pollCard.querySelectorAll('.option-vote').forEach(el => {
    el.onclick = () => {
      const idx = Number(el.dataset.index);

      if (isMulti) {
        if (selected.has(idx)) {
          selected.delete(idx);
        } else {
          if (selected.size >= maxLimit) {
            alert(`本投票最多只能選擇 ${maxLimit} 個選項！`);
            return;
          }
          selected.add(idx);
        }
      } else {
        // 單選模式
        selected.clear();
        selected.add(idx);
      }

      // 重新渲染選項狀態
      pollCard.querySelectorAll('.option-vote').forEach(opt => {
        const i = Number(opt.dataset.index);
        const active = selected.has(i);
        opt.classList.toggle('selected', active);
        const existingStatus = opt.querySelector('.status-tag');
        if (active) {
          if (!existingStatus) {
            const span = document.createElement('span');
            span.className = 'status-tag';
            span.style.cssText = 'font-size:12px; color:var(--primary); font-weight:600;';
            span.textContent = '已選取';
            opt.appendChild(span);
          }
        } else if (existingStatus) {
          existingStatus.remove();
        }
      });

      updateUI();
    };
  });

  if (isEditing) {
    document.getElementById('cancelEditBtn').onclick = () => {
      renderResults(poll, '你已經完成投票，以下是目前開票結果：', preSelected);
    };
  }

  submitBtn.onclick = async () => {
    if (selected.size === 0) return;

    const voterName = voterNameInput.value.trim();
    if (!voterName) {
      voterNameInput.focus();
      voterNameInput.style.borderColor = '#ef4444';
      alert('請填寫你的暱稱才能送出投票！');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '送出中...';
    pollCard.querySelectorAll('.option-vote').forEach(o => (o.style.pointerEvents = 'none'));

    try {
      const optionIndices = Array.from(selected);
      const res = await fetch(`/api/polls/${shortCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voterId,
          voterName,
          optionIndices
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '投票失敗');
      }

      // 儲存到 LocalStorage
      localStorage.setItem(votedKey, JSON.stringify({ voterId, optionIndices }));

      const successMsg = data.isChange ? '選項已成功更新！以下是最新開票結果：' : '感謝你的投票！以下是最新開票結果：';
      renderResults({ ...poll, options: data.results }, successMsg, optionIndices);
    } catch (err) {
      alert(err.message);
      loadPoll();
    }
  };
}

function renderResults(poll, message, userVotes = []) {
  const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const isMulti = Boolean(poll.isMultiple);
  const modeBadgeText = isMulti ? `複選 (上限 ${poll.maxChoices || 2} 票)` : '單選';

  const userVotesArray = Array.isArray(userVotes) ? userVotes : [];
  const chosenTexts = userVotesArray
    .map(idx => poll.options.find(o => o.index === idx)?.text)
    .filter(Boolean);

  let noticeHtml = '';
  if (chosenTexts.length > 0) {
    noticeHtml = `
      <div class="voted-notice-card">
        <div class="voted-notice-text">
          <div><strong>📌 你的選票：</strong>${escapeHtml(chosenTexts.join('、 '))}</div>
          ${poll.active ? '<span style="font-size: 11.5px; color: #4338ca;">投票正式結束前，隨時可按右側按鈕更換選項</span>' : '<span style="font-size: 11.5px; color: #64748b;">本投票已結束，選票已鎖定無法變更</span>'}
        </div>
        ${poll.active ? `
          <button class="btn-outline" id="changeVoteBtn" style="flex-shrink:0;">
            ✏️ 更換選項
          </button>
        ` : ''}
      </div>
    `;
  }

  pollCard.innerHTML = `
    <div class="poll-mode-header">
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="poll-mode-badge">${modeBadgeText}</span>
        <span class="badge ${poll.active ? '' : 'inactive'}">${poll.active ? '進行中' : '已結束'}</span>
      </div>
      <span style="font-size: 13px; color: var(--text-muted);">共 ${total} 票</span>
    </div>

    <h1>${escapeHtml(poll.title)}</h1>
    <p class="subtitle">${escapeHtml(message)}</p>

    ${noticeHtml}

    <div style="margin-top: 14px;">
      ${poll.options.map(o => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        const isMyChoice = userVotesArray.includes(o.index);

        return `
          <div style="margin-bottom: 16px;">
            <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:500; margin-bottom: 4px;">
              <span style="display: flex; align-items: center; gap: 6px;">
                ${escapeHtml(o.text)}
                ${isMyChoice ? '<span style="font-size: 11px; background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-weight: 600;">你的選擇</span>' : ''}
              </span>
              <span><strong>${o.votes}</strong> 票 (${pct}%)</span>
            </div>
            <div class="bar-bg">
              <div class="bar-fill" style="width:${pct}%;"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-muted);">
      <span>總累計票數：<strong>${total}</strong> 票</span>
      <button class="btn-secondary" id="refreshBtn" style="padding: 6px 12px; font-size: 13px;">
        🔄 重新整理結果
      </button>
    </div>
  `;

  const changeBtn = document.getElementById('changeVoteBtn');
  if (changeBtn) {
    changeBtn.onclick = () => {
      renderVoteForm(poll, userVotesArray, true);
    };
  }

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      loadPoll();
    };
  }
}

loadPoll();
