const pollCard = document.getElementById('pollCard');
const shortCode = window.location.pathname.split('/').pop();

// 用 localStorage 做「這台裝置是否已投過票」的簡單防呆（非嚴謹防刷票，之後可升級）
const votedKey = `voted_${shortCode}`;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadPoll() {
  const res = await fetch(`/api/polls/${shortCode}`);
  if (!res.ok) {
    pollCard.innerHTML = '<div class="empty">找不到這個投票，連結可能已失效。</div>';
    return;
  }
  const poll = await res.json();
  const alreadyVoted = localStorage.getItem(votedKey);

  if (!poll.active) {
    renderResults(poll, '這個投票已經結束，以下是最終結果：');
    return;
  }

  if (alreadyVoted) {
    renderResults(poll, '你已經投過票了，以下是目前結果：');
    return;
  }

  renderVoteForm(poll);
}

function renderVoteForm(poll) {
  pollCard.innerHTML = `
    <h1>${escapeHtml(poll.title)}</h1>
    <p class="subtitle">點選一個選項送出投票</p>
    <div id="optionsArea">
      ${poll.options.map(o => `
        <div class="option-vote" data-index="${o.index}">${escapeHtml(o.text)}</div>
      `).join('')}
    </div>
  `;

  pollCard.querySelectorAll('.option-vote').forEach(el => {
    el.onclick = async () => {
      const optionIndex = Number(el.dataset.index);
      pollCard.querySelectorAll('.option-vote').forEach(o => (o.style.pointerEvents = 'none'));

      const res = await fetch(`/api/polls/${shortCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex })
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || '投票失敗');
        return loadPoll();
      }

      localStorage.setItem(votedKey, '1');
      renderResults({ ...poll, options: data.results }, '感謝你的投票！以下是目前結果：');
    };
  });
}

function renderResults(poll, message) {
  const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
  pollCard.innerHTML = `
    <h1>${escapeHtml(poll.title)}</h1>
    <p class="subtitle">${message}</p>
    ${poll.options.map(o => {
      const pct = total ? Math.round((o.votes / total) * 100) : 0;
      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; font-size:14px;">
            <span>${escapeHtml(o.text)}</span>
            <span>${o.votes} 票（${pct}%）</span>
          </div>
          <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;"></div></div>
        </div>
      `;
    }).join('')}
    <p class="poll-meta">共 ${total} 票</p>
  `;
}

loadPoll();
