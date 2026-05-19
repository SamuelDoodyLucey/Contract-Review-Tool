  let activeTab = 'paste';
  let uploadedText = '';
  let loadingTimer;
  let currentContractType = null;
  let currentTypeLabel = null;
  let currentClauses = [];
  let currentFilter = 'all';
  let allExpanded = false;

  const loadingMessages = [
    'Reading the contract…',
    'Identifying key clauses…',
    'Checking for risk language…',
    'Flagging missing provisions…',
    'Reviewing liability terms…',
    'Drafting clause-by-clause analysis…',
    'Suggesting redline points…',
    'Preparing your report…'
  ];

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.sidebar .tab-btn').forEach((b, i) => {
      b.classList.toggle('active', (i === 0 && tab === 'paste') || (i === 1 && tab === 'upload'));
    });
    document.getElementById('paste-panel').style.display = tab === 'paste' ? 'block' : 'none';
    document.getElementById('upload-panel').style.display = tab === 'upload' ? 'block' : 'none';
  }

  function switchView(view) {
    document.querySelectorAll('.view-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.getElementById('summary-view').style.display = view === 'summary' ? 'block' : 'none';
    document.getElementById('clauses-view').style.display = view === 'clauses' ? 'block' : 'none';
  }

  function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.add('drag');
  }

  function handleDragLeave() {
    document.getElementById('drop-zone').classList.remove('drag');
  }

  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
  }

  function processFile(file) {
    const zone = document.getElementById('drop-zone');
    const dropLabel = document.getElementById('drop-label');
    const dropSub = document.getElementById('drop-sub');

    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const isDOCX = file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isDOCX) {
      dropLabel.textContent = 'DOCX not yet supported';
      dropSub.textContent = 'Please paste the text directly or export as PDF/TXT';
      zone.classList.remove('has-file');
      uploadedText = '';
      return;
    }

    if (isPDF) {
      dropLabel.textContent = 'Extracting text…';
      dropSub.textContent = file.name;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          let pageCount = pdf.numPages;

          for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
          }

          uploadedText = fullText;
          zone.classList.add('has-file');
          dropLabel.textContent = file.name;
          dropSub.textContent = pageCount + ' pages · ' + (file.size / 1024).toFixed(0) + ' KB — ready';
        } catch (err) {
          dropLabel.textContent = 'Could not read file';
          dropSub.textContent = err.message || 'Error extracting PDF text';
          zone.classList.remove('has-file');
          uploadedText = '';
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedText = e.target.result;
        zone.classList.add('has-file');
        dropLabel.textContent = file.name;
        dropSub.textContent = (file.size / 1024).toFixed(0) + ' KB — ready';
      };
      reader.onerror = (err) => {
        dropLabel.textContent = 'Could not read file';
        dropSub.textContent = err.message || 'Error reading file';
        zone.classList.remove('has-file');
        uploadedText = '';
      };
      reader.readAsText(file);
    }
  }

  function resetTool() {
    ['loading-state', 'error-state', 'results-state'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('contract-text').value = '';
    document.getElementById('notes-field').value = '';
    uploadedText = '';
    currentClauses = [];
    currentFilter = 'all';
    allExpanded = false;
    const zone = document.getElementById('drop-zone');
    zone.classList.remove('has-file', 'drag');
    document.getElementById('drop-label').textContent = 'Drop a file here';
    document.getElementById('drop-sub').textContent = 'PDF, Word, or plain text';
    document.getElementById('file-input').value = '';
    switchTab('paste');
    switchView('summary');
  }

  function showState(id) {
    ['empty-state', 'loading-state', 'error-state', 'results-state'].forEach(s => {
      document.getElementById(s).style.display = s === id ? (s === 'empty-state' ? 'flex' : 'block') : 'none';
    });
  }

  async function analyseContract() {
    const apiKey = document.getElementById('api-key').value.trim();
    const contractType = document.getElementById('contract-type').value;
    const text = activeTab === 'paste'
      ? document.getElementById('contract-text').value.trim()
      : uploadedText.trim();

    if (!apiKey) return alert('Please enter your Anthropic API key.');
    if (!text || text.length < 80) return alert('Please provide a contract with enough text to analyse.');

    showState('loading-state');
    document.getElementById('analyse-btn').disabled = true;

    let msgIdx = 0;
    loadingTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      document.getElementById('loading-msg').textContent = loadingMessages[msgIdx];
    }, 2200);

    const typeLabels = {
      licensing: 'licensing and services agreement',
      commercial: 'commercial supply agreement',
      employment: 'employment contract',
      nda: 'non-disclosure agreement',
      shareholders: 'shareholders agreement',
      general: 'general commercial contract'
    };

    const systemPrompt = `You are a specialist commercial solicitor reviewing a ${typeLabels[contractType] || 'commercial contract'} on behalf of a client. Produce two deliverables in a single JSON response: (1) an executive summary with overall risk flags, and (2) a detailed clause-by-clause breakdown in the exact order the clauses appear in the contract.

Return ONLY a valid JSON object in this exact shape, with no preamble or markdown:
{
  "summary": "2-3 sentence plain English overview of what this contract does, who the parties are, and the overall balance of risk for the client",
  "risks": [
    {
      "title": "Short descriptive title",
      "severity": "critical|high|medium|low|info",
      "detail": "1-2 sentences explaining the risk and why it matters practically to the client"
    }
  ],
  "clauses": [
    {
      "number": "exact clause reference from the contract, e.g. '4.2', 'Section 7', 'Clause 12(b)' — verbatim from the document",
      "name": "the clause heading or a short descriptive name if untitled",
      "summary": "1-3 sentences in plain English explaining what this clause actually does and how it affects the client",
      "risk": "critical|high|medium|low",
      "flags": ["Liability", "IP"],
      "specificRisks": ["Concrete risk point 1", "Concrete risk point 2"],
      "redline": "A concrete negotiation or redline suggestion the client could push for — what to ask the other side to change and why. Empty string if no change recommended.",
      "originalText": "A short verbatim excerpt (max ~300 chars) of the most material language from the clause, or empty string if not useful"
    }
  ]
}

Severity guide (used for both summary risks and clause risk ratings):
- critical: unlimited or grossly excessive liability, IP transfer to wrong party, unilateral termination without remedy, illegal/unenforceable terms, data protection breach exposure
- high: significantly disadvantages the client, missing critical protections, one-sided termination, broad indemnities
- medium: one-sided terms, provisions needing negotiation, unusual restrictions, ambiguous language
- low: minor imbalances, standard but worth noting, drafting tidy-ups
- info: neutral observations, missing boilerplate (summary risks only)

Flag taxonomy (use these labels in clauses[].flags — pick all that apply, or use "Other" if none fit):
Liability, Indemnity, IP, Confidentiality, Data Protection, Termination, Payment, Warranties, Limitation Period, Auto-renewal, Assignment, Governing Law, Jurisdiction, Dispute Resolution, Non-compete, Non-solicit, Audit Rights, Force Majeure, Change of Control, Insurance, Service Levels, Boilerplate, Definitions, Other

Critical rules for the clauses array:
- Preserve the EXACT order the clauses appear in the contract. Do not reorder by severity.
- Use the contract's actual numbering verbatim (e.g. "4.2(b)", "Schedule 1, para 3", "Section II.A"). Do not invent numbering.
- Include every substantive clause. Skip pure recitals and signature blocks unless they contain material terms.
- Group sub-clauses under their parent only if they form one logical unit; otherwise list separately.
- For the summary "risks" array, sort highest severity first. Focus on the top 8-15 issues.
- Return ONLY the JSON. No explanation, no markdown fences.`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 16000,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Please analyse this contract:\n\n${text.slice(0, 120000)}` }]
        })
      });

      clearInterval(loadingTimer);
      document.getElementById('analyse-btn').disabled = false;

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const raw = data.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch (parseErr) {
        // Try to salvage truncated JSON
        let recovered = clean;
        // Close any open array/object
        const lastBrace = recovered.lastIndexOf('}');
        if (lastBrace > 0) {
          recovered = recovered.slice(0, lastBrace + 1);
          // Close outer object if needed
          const openBraces = (recovered.match(/\{/g) || []).length;
          const closeBraces = (recovered.match(/\}/g) || []).length;
          const openBrackets = (recovered.match(/\[/g) || []).length;
          const closeBrackets = (recovered.match(/\]/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) recovered += ']';
          for (let i = 0; i < openBraces - closeBraces; i++) recovered += '}';
        }
        try {
          parsed = JSON.parse(recovered);
        } catch {
          throw new Error('The contract may be too long. Try pasting only the key sections and running again.');
        }
      }

      renderResults(parsed, contractType, typeLabels);

    } catch (err) {
      clearInterval(loadingTimer);
      document.getElementById('analyse-btn').disabled = false;
      showState('error-state');
      document.getElementById('error-msg').textContent = 'Error: ' + err.message;
    }
  }

  function renderResults(data, contractType, typeLabels) {
    showState('results-state');

    currentContractType = contractType;
    currentTypeLabel = typeLabels[contractType] || 'Contract';
    currentClauses = data.clauses || [];
    currentFilter = 'all';
    allExpanded = false;

    const now = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('results-meta').textContent =
      `${currentTypeLabel} · Reviewed ${now}`;

    document.getElementById('summary-text').textContent = data.summary || '';

    // Risk summary counts (summary view)
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    (data.risks || []).forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

    const summaryEl = document.getElementById('risk-summary');
    summaryEl.innerHTML = '';
    const labels = { critical: 'Critical', high: 'High risk', medium: 'Medium risk', low: 'Low risk', info: 'Notes' };
    Object.entries(counts).forEach(([sev, count]) => {
      if (count === 0) return;
      summaryEl.innerHTML += `
        <div class="risk-count">
          <div class="risk-count-dot dot-${sev}"></div>
          <span>${count} ${labels[sev]}</span>
        </div>`;
    });

    // Risk cards
    const grid = document.getElementById('risk-grid');
    grid.innerHTML = '';

    if (!data.risks || data.risks.length === 0) {
      grid.innerHTML = '<p style="font-size:13px;color:var(--ink-faint);">No significant risks identified.</p>';
    } else {
      const pillLabels = { critical: 'Critical', high: 'High Risk', medium: 'Medium Risk', low: 'Low Risk', info: 'Note' };
      data.risks.forEach(risk => {
        const card = document.createElement('div');
        card.className = 'risk-card';
        card.innerHTML = `
          <div class="risk-card-header">
            <div class="severity-bar sev-${risk.severity}"></div>
            <span class="risk-title">${escapeHtml(risk.title)}</span>
            <span class="sev-pill pill-${risk.severity}">${pillLabels[risk.severity] || risk.severity}</span>
          </div>
          <div class="risk-detail">${escapeHtml(risk.detail)}</div>
        `;
        grid.appendChild(card);
      });
    }

    // Clause count badge
    document.getElementById('clause-count').textContent = currentClauses.length;

    // Render clauses
    renderClauses();
  }

  function renderClauses() {
    const list = document.getElementById('clause-list');
    list.innerHTML = '';

    const filtered = currentFilter === 'all'
      ? currentClauses
      : currentClauses.filter(c => c.risk === currentFilter);

    if (filtered.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--ink-faint);padding:1rem;">No clauses match this filter.</p>';
      return;
    }

    const riskLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

    filtered.forEach((clause, idx) => {
      const card = document.createElement('div');
      card.className = 'clause-card';
      if (allExpanded) card.classList.add('open');

      const flags = (clause.flags || []).map(f =>
        `<span class="flag-tag">${escapeHtml(f)}</span>`
      ).join('');

      const specificRisks = (clause.specificRisks || []).map(r =>
        `<li>${escapeHtml(r)}</li>`
      ).join('');

      const hasOriginal = clause.originalText && clause.originalText.trim().length > 0;
      const hasRedline = clause.redline && clause.redline.trim().length > 0;
      const hasRisks = specificRisks.length > 0;

      card.innerHTML = `
        <div class="clause-header" onclick="toggleClause(this)">
          <div class="clause-sev-bar sev-${clause.risk || 'low'}"></div>
          <div class="clause-header-body">
            <span class="clause-num">${escapeHtml(clause.number || '—')}</span>
            <span class="clause-name">${escapeHtml(clause.name || 'Untitled clause')}</span>
            <span class="sev-pill pill-${clause.risk || 'low'}">${riskLabels[clause.risk] || 'Low'}</span>
            <svg class="clause-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div class="clause-body">
          <div class="clause-section">
            <div class="clause-section-label">Plain English</div>
            <div class="clause-summary">${escapeHtml(clause.summary || '')}</div>
          </div>

          ${flags ? `
          <div class="clause-section">
            <div class="clause-section-label">Flags</div>
            <div class="clause-flags">${flags}</div>
          </div>` : ''}

          ${hasRisks ? `
          <div class="clause-section">
            <div class="clause-section-label">Specific Risks</div>
            <ul class="clause-risks">${specificRisks}</ul>
          </div>` : ''}

          ${hasRedline ? `
          <div class="clause-section">
            <div class="redline-box">
              <strong>Redline / Negotiation Point</strong>
              ${escapeHtml(clause.redline)}
            </div>
          </div>` : ''}

          ${hasOriginal ? `
          <div class="clause-section">
            <button class="original-toggle" onclick="toggleOriginal(event, ${idx})">Show original text</button>
            <div class="original-text" id="original-${idx}" style="display:none;margin-top:8px;">${escapeHtml(clause.originalText)}</div>
          </div>` : ''}
        </div>
      `;
      list.appendChild(card);
    });
  }

  function toggleClause(headerEl) {
    headerEl.parentElement.classList.toggle('open');
  }

  function toggleOriginal(e, idx) {
    e.stopPropagation();
    const el = document.getElementById('original-' + idx);
    const btn = e.target;
    if (el.style.display === 'none') {
      el.style.display = 'block';
      btn.textContent = 'Hide original text';
    } else {
      el.style.display = 'none';
      btn.textContent = 'Show original text';
    }
  }

  function toggleAllClauses() {
    allExpanded = !allExpanded;
    document.querySelectorAll('.clause-card').forEach(c => {
      c.classList.toggle('open', allExpanded);
    });
    document.getElementById('expand-all-btn').textContent = allExpanded ? 'Collapse all' : 'Expand all';
  }

  function filterClauses(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.filter === filter);
    });
    renderClauses();
    if (allExpanded) {
      document.querySelectorAll('.clause-card').forEach(c => c.classList.add('open'));
    }
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function saveNotes() {
    const notes = document.getElementById('notes-field').value;
    localStorage.setItem('contract-review-notes', notes);
    const confirm = document.getElementById('save-confirm');
    confirm.classList.add('show');
    setTimeout(() => confirm.classList.remove('show'), 2000);
  }

  function exportPDF() {
    const now = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
    const headerDiv = document.createElement('div');
    headerDiv.className = 'print-header';
    headerDiv.innerHTML = `Contract Review — ${currentTypeLabel} — ${now}`;
    document.getElementById('results-state').insertBefore(headerDiv, document.getElementById('results-state').firstChild);

    // Add a page break between summary and clauses sections in print
    const clausesView = document.getElementById('clauses-view');
    clausesView.classList.add('print-section-break');

    window.print();

    headerDiv.remove();
    clausesView.classList.remove('print-section-break');
  }

  // Restore notes on load
  window.addEventListener('load', () => {
    const saved = localStorage.getItem('contract-review-notes');
    if (saved) document.getElementById('notes-field').value = saved;
  });
