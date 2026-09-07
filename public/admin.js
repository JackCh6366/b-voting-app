const optionsList = document.getElementById('optionsList');
const addOptionBtn = document.getElementById('addOptionBtn');
const createBtn = document.getElementById('createBtn');
const titleInput = document.getElementById('titleInput');
const pollListEl = document.getElementById('pollList');

function addOptionRow(value = '') {
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `
    <input type="text" placeholder="選項內容" value="${escapeHtml(value)}" />
    <button class="btn-secondary removeOptionBtn" type="button">刪除</button>
  `;
  row.querySelector('.removeOptionBtn').onclick = () => row.remove();
  optionsList.appendChild(row);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

addOptionBtn.onclick = () => addOptionRow();
// 預設先給兩個空白選項
addOptionRow();
addOptionRow();

createBtn.onclick = async () => {
  const title = titleInput.value.trim();
  const options = [...optionsList.querySelectorAll('input')]
    .map(i => i.value.trim())
    .filter(Boolean);

  if (!title) return alert('請輸入投票主題');
  if (options.length < 2) return alert('請至少輸入兩個選項');

  createBtn.disabled = true;
  try {
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, options })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '建立失敗');

    titleInput.value = '';
    optionsList.innerHTML = '';
    addOptionRow();
    addOptionRow();

    await loadPolls();
    alert(`投票建立成功！\n短連結：${data.voteUrl}`);
  } catch (err) {
    alert(err.message);
  } finally {
    createBtn.disabled = false;
  }
};

async function loadPolls() {
  const res = await fetch('/api/polls');
  const polls = await res.json();

  if (polls.length === 0) {
    pollListEl.innerHTML = '<div class="empty">尚未建立任何投票</div>';
    return;
  }

  pollListEl.innerHTML = polls.map(p => {
    const totalVotes = p.options.reduce((sum, o) => sum + o.votes, 0);
    return `
      <div class="poll-item" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="poll-title">${escapeHtml(p.title)}</div>
            <div class="poll-meta">
              共 ${totalVotes} 票 ·
              <span class="badge ${p.active ? '' : 'inactive'}">${p.active ? '進行中' : '已結束'}</span>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary toggleBtn" data-code="${p.shortCode}" data-active="${p.active}">
              ${p.active ? '結束投票' : '重新開放'}
            </button>
            <button class="btn-secondary syncBtn" data-code="${p.shortCode}">同步到 Sheet</button>
            <button class="btn-danger deleteBtn" data-code="${p.shortCode}">刪除</button>
          </div>
        </div>
        <div class="link-box" style="margin-top:10px;">
          <span style="flex:1;">${p.voteUrl}</span>
          <button class="btn-secondary copyBtn" data-url="${p.voteUrl}">複製</button>
        </div>
        <div style="margin-top:10px;">
          ${p.options.map(o => {
            const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
            return `
              <div style="font-size:13px; margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between;">
                  <span>${escapeHtml(o.text)}</span>
                  <span>${o.votes} 票（${pct}%）</span>
                </div>
                <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;"></div></div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  pollListEl.querySelectorAll('.copyBtn').forEach(btn => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = '已複製！';
      setTimeout(() => (btn.textContent = '複製'), 1500);
    };
  });

  pollListEl.querySelectorAll('.deleteBtn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('確定要刪除這個投票嗎？此動作無法復原。')) return;
      await fetch(`/api/polls/${btn.dataset.code}`, { method: 'DELETE' });
      loadPolls();
    };
  });

  pollListEl.querySelectorAll('.toggleBtn').forEach(btn => {
    btn.onclick = async () => {
      const isActive = btn.dataset.active === 'true';
      await fetch(`/api/polls/${btn.dataset.code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !isActive })
      });
      loadPolls();
    };
  });

  pollListEl.querySelectorAll('.syncBtn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '同步中...';
      try {
        const res = await fetch(`/api/polls/${btn.dataset.code}/sync`, { method: 'POST' });
        const data = await res.json();
        if (data.skipped) {
          alert('尚未設定 Google Sheets，請參考 README 完成設定。');
        } else {
          alert('已同步到 Google Sheet！');
        }
      } catch (err) {
        alert('同步失敗：' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '同步到 Sheet';
      }
    };
  });
}

loadPolls();
