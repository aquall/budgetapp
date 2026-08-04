/**
 * Tab 4: Settings & Configuration Module
 */
window.SettingsModule = (function () {

  const CATEGORY_NAMES = {
    rent: "Rent",
    groceries: "Groceries",
    utilities: "Utilities",
    leisure: "Leisure",
    travel: "Travel",
    other: "Other"
  };

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
            <div style="font-weight:600; font-size:0.9rem;">${acc.name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${acc.officialName || acc.subtype}</div>
          </div>
          <div>
            <select class="form-control btn-sm acc-type-select" data-acc-id="${acc.id}" style="width:130px;">
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
    Object.keys(CATEGORY_NAMES).forEach(cat => {
      const val = budgets[cat] !== undefined ? budgets[cat] : 300;
      html += `
        <div class="form-group">
          <label class="form-label" for="budgetGoal_${cat}">${CATEGORY_NAMES[cat]} ($ / Month)</label>
          <input type="number" id="budgetGoal_${cat}" class="form-control budget-goal-input" data-cat="${cat}" value="${val}" min="0" step="10">
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
          <input type="text" class="form-control rule-keyword" value="${rule.keyword}" placeholder="Keyword (e.g. Trader Joe)">
          <select class="form-control rule-category">
            ${Object.keys(CATEGORY_NAMES).map(cat => `
              <option value="${cat}" ${rule.category === cat ? "selected" : ""}>${CATEGORY_NAMES[cat]}</option>
            `).join("")}
          </select>
          <button type="button" class="btn btn-sm btn-danger btn-remove-rule">X</button>
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
      if (keyword) {
        rules.push({ keyword, category });
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
      <button type="button" class="btn btn-sm btn-danger btn-remove-rule">X</button>
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
    document.getElementById("plaidSecret").value = plaid.secret || "";
    document.getElementById("plaidEnv").value = plaid.env || "sandbox";
    document.getElementById("plaidAccessToken").value = plaid.accessToken || "";

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
