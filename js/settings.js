/**
 * Tab 4: Settings & Configuration Module
 */
window.SettingsModule = (function () {
  const { escapeHtml } = window.AppUtils;

  const CATEGORY_NAMES = window.AppUtils.categoryLabels;
  const BUDGET_CATEGORIES = ["rent", "groceries", "utilities", "leisure", "travel", "other"];

  /**
   * Render Account Spending vs Savings designation toggles
   */
  function renderAccountDesignations(state, onAccountTypeChange) {
    const container = document.getElementById("accountDesignationList");
    if (!container) return;

    const accounts = state.accounts || [];
    if (accounts.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem;">No accounts loaded.</div>`;
      return;
    }

    let html = "";
    accounts.forEach(acc => {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color);">
          <div>
            <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(acc.name)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(acc.officialName || acc.subtype || "")}</div>
          </div>
          <div>
            <select class="form-control btn-sm acc-type-select" data-acc-id="${escapeHtml(acc.id)}" style="width:130px;">
              <option value="spending" ${acc.type === "spending" ? "selected" : ""}>Spending</option>
              <option value="savings" ${acc.type === "savings" ? "selected" : ""}>Savings</option>
            </select>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Change event listeners
    container.querySelectorAll(".acc-type-select").forEach(select => {
      select.addEventListener("change", (e) => {
        const accId = e.target.getAttribute("data-acc-id");
        const newType = e.target.value;
        if (onAccountTypeChange) {
          onAccountTypeChange(accId, newType);
        }
      });
    });
  }

  function renderPlaidConnections(connections, onDisconnect) {
    const container = document.getElementById("plaidConnectionsList");
    if (!container) return;
    container.replaceChildren();

    if (!connections?.length) {
      const empty = document.createElement("p");
      empty.className = "plaid-connections-empty";
      empty.textContent = "No institutions connected yet.";
      container.appendChild(empty);
      return;
    }

    connections.forEach(connection => {
      const row = document.createElement("div");
      row.className = "plaid-connection-row";
      const name = document.createElement("span");
      name.textContent = connection.institution || "Institution";
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "btn btn-sm btn-danger";
      disconnect.textContent = "Disconnect";
      disconnect.setAttribute("aria-label", `Disconnect ${connection.institution || "institution"}`);
      disconnect.addEventListener("click", () => onDisconnect?.(connection.connectionId));
      row.append(name, disconnect);
      container.appendChild(row);
    });
  }

  /**
   * Render Monthly Budget Goals Form Fields
   */
  function renderBudgetGoalsForm(state) {
    const container = document.getElementById("budgetGoalsFormGrid");
    if (!container) return;

    const budgets = state.budgets || {
      rent: 1600,
      groceries: 600,
      utilities: 250,
      leisure: 300,
      travel: 200,
      other: 250
    };

    let html = "";
    BUDGET_CATEGORIES.forEach(cat => {
      const val = budgets[cat] !== undefined ? budgets[cat] : 300;
      html += `
        <div class="form-group">
          <label class="form-label" for="budgetGoal_${cat}">${CATEGORY_NAMES[cat]} ($ / Month)</label>
          <input type="number" id="budgetGoal_${cat}" class="form-control budget-goal-input" data-cat="${cat}" value="${escapeHtml(val)}" min="0" step="10">
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /**
   * Render Category Keyword Mapping Rules List
   */
  function renderKeywordRules(state) {
    const container = document.getElementById("keywordRulesContainer");
    if (!container) return;

    const rules = state.keywordRules || [
      { keyword: "trader joe", category: "groceries" },
      { keyword: "verizon", category: "utilities" },
      { keyword: "conedison", category: "utilities" },
      { keyword: "equity", category: "rent" },
      { keyword: "steam", category: "leisure" },
      { keyword: "starbucks", category: "leisure" },
      { keyword: "delta", category: "travel" }
    ];

    let html = "";
    rules.forEach((rule, idx) => {
      html += `
        <div class="rule-item" data-rule-idx="${idx}">
          <input type="text" class="form-control rule-keyword" value="${escapeHtml(rule.keyword)}" placeholder="Keyword (e.g. Trader Joe)">
          <select class="form-control rule-category">
            ${Object.keys(CATEGORY_NAMES).map(cat => `
              <option value="${cat}" ${rule.category === cat ? "selected" : ""}>${CATEGORY_NAMES[cat]}</option>
            `).join("")}
          </select>
          <select class="form-control rule-direction" aria-label="Transaction direction">
            <option value="outflow" ${(rule.direction || "outflow") === "outflow" ? "selected" : ""}>Withdrawal</option>
            <option value="inflow" ${rule.direction === "inflow" ? "selected" : ""}>Deposit</option>
            <option value="any" ${rule.direction === "any" ? "selected" : ""}>Either</option>
          </select>
          <button type="button" class="btn btn-sm btn-danger btn-remove-rule" aria-label="Remove category rule">Remove</button>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach remove rule listeners
    container.querySelectorAll(".btn-remove-rule").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const item = e.target.closest(".rule-item");
        item.remove();
      });
    });
  }

  /**
   * Reads keyword rules from DOM
   */
  function getKeywordRulesFromDOM() {
    const container = document.getElementById("keywordRulesContainer");
    if (!container) return [];

    const rules = [];
    container.querySelectorAll(".rule-item").forEach(item => {
      const keyword = item.querySelector(".rule-keyword").value.trim();
      const category = item.querySelector(".rule-category").value;
      const direction = item.querySelector(".rule-direction").value;
      if (keyword) {
        rules.push({ keyword, category, direction });
      }
    });

    return rules;
  }

  /**
   * Adds a new blank keyword rule row to DOM
   */
  function addKeywordRuleRow() {
    const container = document.getElementById("keywordRulesContainer");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "rule-item";
    div.innerHTML = `
      <input type="text" class="form-control rule-keyword" placeholder="New Keyword (e.g. Netflix)">
      <select class="form-control rule-category">
        ${Object.keys(CATEGORY_NAMES).map(cat => `
          <option value="${cat}">${CATEGORY_NAMES[cat]}</option>
        `).join("")}
      </select>
      <select class="form-control rule-direction" aria-label="Transaction direction">
        <option value="outflow" selected>Withdrawal</option>
        <option value="inflow">Deposit</option>
        <option value="any">Either</option>
      </select>
      <button type="button" class="btn btn-sm btn-danger btn-remove-rule" aria-label="Remove category rule">Remove</button>
    `;

    div.querySelector(".btn-remove-rule").addEventListener("click", () => {
      div.remove();
    });

    container.appendChild(div);
  }

  /**
   * Initializes Tab 4
   */
  function init(state, callbacks = {}) {
    // Populate Plaid config form fields
    const plaid = state.plaidConfig || {};
    document.getElementById("plaidClientId").value = plaid.clientId || "";
    document.getElementById("plaidSecret").value = "";
    document.getElementById("plaidEnv").value = plaid.env || "sandbox";
    renderPlaidConnections(state.plaidSessionConnections || [], callbacks.onDisconnect);

    renderAccountDesignations(state, callbacks.onAccountTypeChange);
    renderBudgetGoalsForm(state);
    renderKeywordRules(state);
  }

  return {
    init,
    getKeywordRulesFromDOM,
    addKeywordRuleRow
  };
})();
