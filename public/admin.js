const optionsList = document.getElementById('optionsList');
const addOptionBtn = document.getElementById('addOptionBtn');
const createBtn = document.getElementById('createBtn');
const titleInput = document.getElementById('titleInput');
const noteInput = document.getElementById('noteInput');
const pollListEl = document.getElementById('pollList');
const pollTypeRadios = document.querySelectorAll('input[name="pollType"]');
const multiLimitSection = document.getElementById('multiLimitSection');
const maxChoicesInput = document.getElementById('maxChoicesInput');
const maxChoicesHint = document.getElementById('maxChoicesHint');
const labelSingle = document.getElementById('labelSingle');
const labelMultiple = document.getElementById('labelMultiple');

// AI 輔助建立元件
const aiUploadDropzone = document.getElementById('aiUploadDropzone');
const aiImageInput = document.getElementById('aiImageInput');
const aiUploadPlaceholder = document.getElementById('aiUploadPlaceholder');
const aiPreviewWrap = document.getElementById('aiPreviewWrap');
const aiPreviewImg = document.getElementById('aiPreviewImg');
const aiRemoveImgBtn = document.getElementById('aiRemoveImgBtn');
const aiPromptInput = document.getElementById('aiPromptInput');
const aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn');
const labelGemini = document.getElementById('labelGemini');
const labelNvidia = document.getElementById('labelNvidia');
const aiProviderRadios = document.querySelectorAll('input[name="aiProvider"]');

let currentImageBase64 = null;

// 編輯備註 Modal 元件
const editNoteModal = document.getElementById('editNoteModal');
const modalPollTitle = document.getElementById('modalPollTitle');
const modalNoteTextarea = document.getElementById('modalNoteTextarea');
const closeNoteModalBtn = document.getElementById('closeNoteModalBtn');
const cancelNoteModalBtn = document.getElementById('cancelNoteModalBtn');
const saveNoteModalBtn = document.getElementById('saveNoteModalBtn');
let currentEditingShortCode = null;

function updateMultiLimitBounds() {
  const count = optionsList.querySelectorAll('.option-row').length;
  const maxLimit = Math.max(2, count);
  maxChoicesInput.max = maxLimit;
  maxChoicesInput.min = 2;
  maxChoicesHint.textContent = `（可設定 2 ~ ${maxLimit} 票，不能超過選項總數）`;

  let currentVal = parseInt(maxChoicesInput.value, 10) || 2;
  if (currentVal > maxLimit) {
    maxChoicesInput.value = maxLimit;
  } else if (currentVal < 2) {
    maxChoicesInput.value = 2;
  }
}

pollTypeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const isMulti = radio.value === 'multiple';
    if (isMulti) {
      labelMultiple.classList.add('checked');
      labelSingle.classList.remove('checked');
      multiLimitSection.style.display = 'block';
      updateMultiLimitBounds();
    } else {
      labelSingle.classList.add('checked');
      labelMultiple.classList.remove('checked');
      multiLimitSection.style.display = 'none';
    }
  });
});

function addOptionRow(value = '') {
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `
    <input type="text" placeholder="選項內容" value="${escapeHtml(value)}" />
    <button class="btn-secondary removeOptionBtn" type="button">刪除</button>
  `;
  row.querySelector('.removeOptionBtn').onclick = () => {
    row.remove();
    updateMultiLimitBounds();
  };
  optionsList.appendChild(row);
  updateMultiLimitBounds();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

addOptionBtn.onclick = () => addOptionRow();
// 預設先給兩個空白選項
addOptionRow();
addOptionRow();

// ---------- AI 輔助建立邏輯 ----------

aiProviderRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.value === 'gemini') {
      labelGemini.classList.add('checked');
      labelNvidia.classList.remove('checked');
    } else {
      labelNvidia.classList.add('checked');
      labelGemini.classList.remove('checked');
    }
  });
});

function handleImageFile(file) {
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    return alert('請上傳 JPG、PNG 或 WEBP 格式的圖片！');
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return alert('圖片檔案過大，請選擇小於 10MB 的圖片！');
  }

  const reader = new FileReader();
  reader.onload = e => {
    currentImageBase64 = e.target.result;
    aiPreviewImg.src = currentImageBase64;
    aiPreviewWrap.style.display = 'inline-block';
    aiUploadPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

aiUploadDropzone.addEventListener('click', e => {
  if (e.target !== aiRemoveImgBtn) {
    aiImageInput.click();
  }
});

aiImageInput.addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) {
    handleImageFile(e.target.files[0]);
  }
});

aiUploadDropzone.addEventListener('dragover', e => {
  e.preventDefault();
  aiUploadDropzone.style.borderColor = '#9333ea';
  aiUploadDropzone.style.background = '#faf5ff';
});

aiUploadDropzone.addEventListener('dragleave', () => {
  aiUploadDropzone.style.borderColor = '';
  aiUploadDropzone.style.background = '';
});

aiUploadDropzone.addEventListener('drop', e => {
  e.preventDefault();
  aiUploadDropzone.style.borderColor = '';
  aiUploadDropzone.style.background = '';
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleImageFile(e.dataTransfer.files[0]);
  }
});

aiRemoveImgBtn.addEventListener('click', e => {
  e.stopPropagation();
  currentImageBase64 = null;
  aiImageInput.value = '';
  aiPreviewImg.src = '';
  aiPreviewWrap.style.display = 'none';
  aiUploadPlaceholder.style.display = 'block';
});

aiAnalyzeBtn.onclick = async () => {
  if (!currentImageBase64) {
    return alert('請先上傳要辨識的圖片（例如菜單、海報或清單截圖）！');
  }

  const selectedProvider = document.querySelector('input[name="aiProvider"]:checked')?.value || 'gemini';
  const prompt = aiPromptInput.value.trim();

  aiAnalyzeBtn.disabled = true;
  const originalText = aiAnalyzeBtn.innerHTML;
  aiAnalyzeBtn.innerHTML = '⏳ AI 正在分析圖片中，請稍候...';

  try {
    const res = await fetch('/api/ai/extract-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: currentImageBase64,
        provider: selectedProvider,
        prompt
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'AI 分析失敗');
    }

    if (data.title) {
      titleInput.value = data.title;
    }

    if (Array.isArray(data.options) && data.options.length > 0) {
      optionsList.innerHTML = '';
      data.options.forEach(opt => addOptionRow(opt));
      updateMultiLimitBounds();
    }

    alert('✨ AI 分析完成！已自動將主題與選項填入下方表單。\n請仔細檢查並可自由修改，確認無誤後點選「建立投票」。');
    titleInput.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert(`AI 分析失敗：${err.message}`);
  } finally {
    aiAnalyzeBtn.disabled = false;
    aiAnalyzeBtn.innerHTML = originalText;
  }
};

// ---------- 建立投票 ----------

createBtn.onclick = async () => {
  const title = titleInput.value.trim();
  const note = noteInput.value.trim();
  const options = [...optionsList.querySelectorAll('input[type="text"]')]
    .map(i => i.value.trim())
    .filter(Boolean);

  if (!title) return alert('請輸入投票主題');
  if (options.length < 2) return alert('請至少輸入兩個選項');

  const selectedType = document.querySelector('input[name="pollType"]:checked').value;
  const isMultiple = selectedType === 'multiple';
  let maxChoices = 1;

  if (isMultiple) {
    maxChoices = parseInt(maxChoicesInput.value, 10);
    if (isNaN(maxChoices) || maxChoices < 2 || maxChoices > options.length) {
      return alert(`複選投票的最高票數限制必須介於 2 到 ${options.length} 之間！`);
    }
  }

  createBtn.disabled = true;
  try {
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, note, options, isMultiple, maxChoices })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '建立失敗');

    titleInput.value = '';
    noteInput.value = '';
    optionsList.innerHTML = '';
    addOptionRow();
    addOptionRow();

    // 重設回單選模式
    document.querySelector('input[name="pollType"][value="single"]').checked = true;
    labelSingle.classList.add('checked');
    labelMultiple.classList.remove('checked');
    multiLimitSection.style.display = 'none';
    maxChoicesInput.value = 2;

    await loadPolls();
    alert(`投票建立成功！\n投票模式：${isMultiple ? `複選（每人最多 ${maxChoices} 票）` : '單選'}\n短連結：${data.voteUrl}`);
  } catch (err) {
    alert(err.message);
  } finally {
    createBtn.disabled = false;
  }
};

// ---------- 編輯備註 Modal 控制 ----------

function openEditNoteModal(poll) {
  currentEditingShortCode = poll.shortCode;
  modalPollTitle.textContent = poll.title;
  modalNoteTextarea.value = poll.note || '';
  editNoteModal.classList.add('active');
  modalNoteTextarea.focus();
}

function closeEditNoteModal() {
  currentEditingShortCode = null;
  editNoteModal.classList.remove('active');
}

closeNoteModalBtn.onclick = closeEditNoteModal;
cancelNoteModalBtn.onclick = closeEditNoteModal;

saveNoteModalBtn.onclick = async () => {
  if (!currentEditingShortCode) return;

  saveNoteModalBtn.disabled = true;
  saveNoteModalBtn.textContent = '儲存中...';

  try {
    const newNote = modalNoteTextarea.value.trim();
    const res = await fetch(`/api/polls/${currentEditingShortCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '備註更新失敗');

    closeEditNoteModal();
    await loadPolls();
  } catch (err) {
    alert(`儲存失敗：${err.message}`);
  } finally {
    saveNoteModalBtn.disabled = false;
    saveNoteModalBtn.textContent = '儲存備註';
  }
};

// ---------- 讀取與渲染所有投票 ----------

async function loadPolls() {
  const res = await fetch('/api/polls');
  const polls = await res.json();

  if (polls.length === 0) {
    pollListEl.innerHTML = '<div class="empty">尚未建立任何投票</div>';
    return;
  }

  pollListEl.innerHTML = polls.map(p => {
    const totalVotes = p.options.reduce((sum, o) => sum + o.votes, 0);
    const modeBadge = p.isMultiple
      ? `<span class="badge multi">複選 (最多 ${p.maxChoices || 2} 票)</span>`
      : `<span class="badge single">單選</span>`;

    const noteHtml = p.note
      ? `<div class="admin-poll-note">📝 <strong>備註：</strong>${escapeHtml(p.note)}</div>`
      : '';

    return `
      <div class="poll-item" data-code="${p.shortCode}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 12px;">
          <div>
            <div class="poll-title">${escapeHtml(p.title)}</div>
            <div class="poll-meta">
              ${modeBadge}
              <span class="badge ${p.active ? '' : 'inactive'}">${p.active ? '進行中' : '已結束'}</span>
              <span>共 <strong>${totalVotes}</strong> 票</span>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
            <button class="btn-secondary editNoteBtn" data-code="${p.shortCode}">編輯備註</button>
            <button class="btn-secondary toggleBtn" data-code="${p.shortCode}" data-active="${p.active}">
              ${p.active ? '結束投票' : '重新開放'}
            </button>
            <button class="btn-secondary syncBtn" data-code="${p.shortCode}">同步到 Sheet</button>
            <button class="btn-danger deleteBtn" data-code="${p.shortCode}">刪除</button>
          </div>
        </div>
        ${noteHtml}
        <div class="link-box" style="margin-top:12px;">
          <span style="flex:1; font-family: monospace;">${p.voteUrl}</span>
          <button class="btn-secondary copyBtn" data-url="${p.voteUrl}">複製</button>
        </div>
        <div style="margin-top:14px;">
          ${p.options.map(o => {
            const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
            return `
              <div style="font-size:13px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-weight: 500;">
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

  pollListEl.querySelectorAll('.editNoteBtn').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      const poll = polls.find(p => p.shortCode === code);
      if (poll) {
        openEditNoteModal(poll);
      }
    };
  });
}

loadPolls();

