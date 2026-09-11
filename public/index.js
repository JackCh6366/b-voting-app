// public/index.js

let allPolls = [];
let currentFilter = 'all';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric'
  });
}

// 快速跳轉到投票
function setupQuickJump() {
  const input = document.getElementById('quickCodeInput');
  const btn = document.getElementById('quickJumpBtn');

  function jump() {
    let val = input.value.trim();
    if (!val) {
      input.focus();
      return;
    }

    // 如果使用者貼上完整網址，自動抓取最後一段 code
    if (val.includes('/v/')) {
      val = val.split('/v/').pop().split(/[?#]/)[0];
    } else if (val.includes('/')) {
      val = val.split('/').pop().split(/[?#]/)[0];
    }

    if (val) {
      window.location.href = `/v/${encodeURIComponent(val)}`;
    }
  }

  btn.addEventListener('click', jump);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') jump();
  });
}

// 載入投票列表
async function loadPolls() {
  const container = document.getElementById('pollsContainer');
  try {
    const res = await fetch('/api/polls');
    if (!res.ok) throw new Error('無法取得投票清單');
    allPolls = await res.json();
    renderPolls();
  } catch (err) {
    container.innerHTML = `
      <div class="state-box">
        <div class="state-icon">⚠️</div>
        <h3>載入失敗</h3>
        <p style="margin-top: 6px; font-size: 13px;">${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderPolls() {
  const container = document.getElementById('pollsContainer');
  let filtered = allPolls;

  if (currentFilter === 'active') {
    filtered = allPolls.filter(p => p.active);
  } else if (currentFilter === 'closed') {
    filtered = allPolls.filter(p => !p.active);
  }

  if (filtered.length === 0) {
    let emptyMsg = '目前尚無投票活動';
    if (currentFilter === 'active') emptyMsg = '目前沒有進行中的投票';
    if (currentFilter === 'closed') emptyMsg = '目前沒有已結束的投票';

    container.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🗳️</div>
        <h3>${emptyMsg}</h3>
        <p style="margin-top: 6px; font-size: 13px;">歡迎進入管理後台建立新的投票主題！</p>
        <a href="/admin.html" class="btn btn-primary" style="margin-top: 16px;">前往建立投票</a>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(poll => {
    const totalVotes = poll.options.reduce((sum, o) => sum + (o.votes || 0), 0);
    const dateStr = formatDate(poll.createdAt);
    
    // 選出票數最高的前 2-3 個選項做預覽
    const previewOptions = poll.options.slice(0, 3);

    const modeBadge = poll.isMultiple
      ? `<span class="poll-status-pill" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">複選 (最多 ${poll.maxChoices || 2} 票)</span>`
      : `<span class="poll-status-pill" style="background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe;">單選</span>`;

    return `
      <div class="poll-card">
        <div class="poll-header">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${modeBadge}
            <span class="poll-status-pill ${poll.active ? 'active' : 'inactive'}">
              ${poll.active ? '進行中' : '已結束'}
            </span>
          </div>
          <span style="font-size: 12px; color: var(--text-light);">${dateStr}</span>
        </div>

        <h3 class="poll-title-text">${escapeHtml(poll.title)}</h3>

        <div class="poll-options-preview">
          ${previewOptions.map(opt => {
            const pct = totalVotes ? Math.round((opt.votes / totalVotes) * 100) : 0;
            return `
              <div class="preview-bar-row">
                <div class="preview-bar-label">
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;">
                    ${escapeHtml(opt.text)}
                  </span>
                  <span>${opt.votes} 票 (${pct}%)</span>
                </div>
                <div class="preview-bar-track">
                  <div class="preview-bar-fill" style="width: ${pct}%"></div>
                </div>
              </div>
            `;
          }).join('')}
          ${poll.options.length > 3 ? `
            <div style="font-size: 11px; color: var(--text-light); text-align: center; margin-top: 6px;">
              還有其他 ${poll.options.length - 3} 個選項...
            </div>
          ` : ''}
        </div>

        <div class="poll-card-footer">
          <span>共 <strong>${totalVotes}</strong> 票</span>
          <a href="/v/${encodeURIComponent(poll.shortCode)}" class="poll-action-link">
            ${poll.active ? '參與投票' : '查看結果'} ➔
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function setupFilters() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderPolls();
    });
  });
}

// 頁面初始化
document.addEventListener('DOMContentLoaded', () => {
  setupQuickJump();
  setupFilters();
  loadPolls();
});
