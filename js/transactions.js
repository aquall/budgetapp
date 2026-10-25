/**
 * Transaction register with on-demand row rendering and vendor classification.
 */
window.TransactionsModule = (function () {
  const PAGE_SIZE = 50;
  const { formatCurrency, escapeHtml, categoryLabels } = window.AppUtils;
  let orderedTransactions = [];
  let accountNames = new Map();
  let keywordRules = [];
  let onCategoryChange = null;
  let renderedCount = 0;

  function renderTransaction(transaction, index) {
    const amount = Number(transaction.amount) || 0;
    const isDeposit = amount < 0;
    const netChange = -amount;
    const flowLabel = isDeposit ? "Deposit" : "Withdrawal";
    const category = window.SpendingModule.classifyCategory(
      transaction.name,
      transaction.category,
      keywordRules,
      amount
    );
    const options = Object.entries(categoryLabels).map(([value, label]) =>
      `<option value="${value}" ${value === category ? "selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(transaction.date || ""))
      ? new Date(`${transaction.date}T00:00:00Z`).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC"
      })
      : "Date unavailable";
    const vendor = String(transaction.name || "Unknown merchant");
    const amountLabel = netChange > 0
      ? `+${formatCurrency(netChange)}`
      : netChange < 0 ? formatCurrency(netChange) : formatCurrency(0);
    const accountName = accountNames.get(transaction.accountId);

    return `
      <article class="transaction-row" data-transaction-index="${index}">
        <div class="transaction-details">
          <div class="transaction-vendor">${escapeHtml(vendor)}</div>
          <div class="transaction-meta">
            <time datetime="${escapeHtml(transaction.date || "")}">${escapeHtml(date)}</time>
            <span>${escapeHtml(accountName || flowLabel)}</span>
            ${transaction.pending ? '<span class="transaction-pending">Pending</span>' : ""}
          </div>
        </div>
        <div class="transaction-actions">
          <span class="transaction-amount ${isDeposit ? "is-deposit" : "is-withdrawal"}" aria-label="${flowLabel} ${escapeHtml(formatCurrency(Math.abs(amount)))}">${escapeHtml(amountLabel)}</span>
          <label class="visually-hidden" for="transactionCategory${index}">Category for ${escapeHtml(vendor)}</label>
          <select id="transactionCategory${index}" class="form-control transaction-category" data-transaction-index="${index}">
            ${options}
          </select>
        </div>
      </article>
    `;
  }

  function bindCategorySelects(list) {
    list.querySelectorAll(".transaction-category[data-transaction-index]").forEach(select => {
      if (select.dataset.bound) return;
      select.dataset.bound = "true";
      select.addEventListener("change", () => {
        const index = Number(select.dataset.transactionIndex);
        const entry = orderedTransactions[index];
        if (entry) onCategoryChange?.(entry.transaction, select.value);
      });
    });
  }

  function loadNextBatch() {
    const list = document.getElementById("transactionsList");
    const scrollArea = document.getElementById("transactionsScroll");
    const moreButton = document.getElementById("transactionsMoreButton");
    const status = document.getElementById("transactionsLoadStatus");
    if (!list || !scrollArea) return;

    const start = renderedCount;
    const end = Math.min(start + PAGE_SIZE, orderedTransactions.length);
    if (end <= start) return;

    list.insertAdjacentHTML("beforeend", orderedTransactions.slice(start, end)
      .map(({ transaction }, offset) => renderTransaction(transaction, start + offset)).join(""));
    renderedCount = end;

    bindCategorySelects(list);

    const hasMore = renderedCount < orderedTransactions.length;
    if (moreButton) moreButton.hidden = !hasMore;
    if (status) status.textContent = hasMore
      ? `Showing ${renderedCount.toLocaleString()} of ${orderedTransactions.length.toLocaleString()} transactions. Scroll for more.`
      : `${renderedCount.toLocaleString()} transaction${renderedCount === 1 ? "" : "s"}`;

    // Fill a short viewport in chunks until it becomes scrollable.
    if (hasMore && scrollArea.scrollHeight <= scrollArea.clientHeight + 8) {
      requestAnimationFrame(loadNextBatch);
    }
  }

  function init(state, onChange) {
    const emptyState = document.getElementById("transactionsEmpty");
    const scrollArea = document.getElementById("transactionsScroll");
    const list = document.getElementById("transactionsList");
    if (!scrollArea || !list) return;

    accountNames = new Map((state.accounts || []).map(account => [account.id, account.name]));
    keywordRules = state.keywordRules || [];
    onCategoryChange = onChange;
    orderedTransactions = (state.transactions || []).map((transaction, originalIndex) => ({ transaction, originalIndex }))
      .sort((a, b) => {
        const dateOrder = String(b.transaction.date || "").localeCompare(String(a.transaction.date || ""));
        return dateOrder || a.originalIndex - b.originalIndex;
      });
    renderedCount = 0;
    list.replaceChildren();

    const hasTransactions = orderedTransactions.length > 0;
    if (emptyState) {
      emptyState.hidden = hasTransactions;
      emptyState.textContent = "No transactions are available yet. Connect an institution or import a backup to get started.";
    }
    scrollArea.hidden = !hasTransactions;
    if (!hasTransactions) return;

    scrollArea.onscroll = () => {
      if (scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 100) loadNextBatch();
    };
    const moreButton = document.getElementById("transactionsMoreButton");
    if (moreButton) moreButton.onclick = loadNextBatch;
    loadNextBatch();
  }

  function refreshCategories(state) {
    accountNames = new Map((state.accounts || []).map(account => [account.id, account.name]));
    keywordRules = state.keywordRules || [];
    const list = document.getElementById("transactionsList");
    if (!list) return;
    list.innerHTML = orderedTransactions.slice(0, renderedCount)
      .map(({ transaction }, index) => renderTransaction(transaction, index)).join("");
    bindCategorySelects(list);
  }

  return { init, refreshCategories };
})();
