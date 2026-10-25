/**
 * Main Application Orchestrator & LocalStorage State Manager
 */
(function () {
  const STORAGE_KEY = "barebones_finance_app_state_v1";

  // Default initial global state
  let appState = {
    plaidConfig: {
      clientId: "",
      env: "sandbox",
      connections: [],
      isConnected: false
    },
    accounts: [],
    transactions: [],
    balanceHistory: [],
    accountHistory: {},
    dataMode: "demo",
    budgets: {
      rent: 1600,
      groceries: 600,
      utilities: 250,
      leisure: 300,
      travel: 200,
      other: 250
    },
    keywordRules: [
      { keyword: "trader joe", category: "groceries" },
      { keyword: "verizon", category: "utilities" },
      { keyword: "conedison", category: "utilities" },
      { keyword: "equity", category: "rent" },
      { keyword: "steam", category: "leisure" },
      { keyword: "starbucks", category: "leisure" },
      { keyword: "delta", category: "travel" }
    ]
  };

  // Active view filters
  let currentTab = "summary";
  let summaryMonths = 3;
  let spendingDays = 90;
  let plaidSecret = "";
  let plaidConnections = [];
  const PLAID_CONNECTIONS_KEY = "budgetapp_plaid_connections";

  /**
   * LocalStorage Helpers
   */
  function loadStateFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        appState = { ...appState, ...parsed };
        appState.plaidConfig = { ...appState.plaidConfig, ...(parsed.plaidConfig || {}) };
        if (!Array.isArray(appState.accounts)) appState.accounts = [];
        if (!Array.isArray(appState.transactions)) appState.transactions = [];
        if (!Array.isArray(appState.balanceHistory)) appState.balanceHistory = [];
        if (!Array.isArray(appState.keywordRules)) appState.keywordRules = [];
        if (!appState.budgets || typeof appState.budgets !== "object" || Array.isArray(appState.budgets)) appState.budgets = {};
        // Older versions stored secrets and fake access tokens in localStorage. Drop them on load.
        delete appState.plaidConfig.secret;
        delete appState.plaidConfig.accessToken;
        delete appState.plaidConfig.connectionId;
        if (!Array.isArray(appState.plaidConfig.connections)) appState.plaidConfig.connections = [];
        if (!appState.accountHistory || typeof appState.accountHistory !== "object") appState.accountHistory = {};
        if (!["demo", "plaid", "imported"].includes(appState.dataMode)) {
          const isLegacyDemo = appState.accounts.some(account => String(account.id).startsWith("acc_"));
          appState.dataMode = appState.accounts.some(account => account.plaidConnectionId)
            ? "plaid"
            : isLegacyDemo ? "demo" : "imported";
        }
        appState.plaidConfig.isConnected = false;
      }
    } catch (e) {
      console.warn("Failed to load state from localStorage:", e);
    }
  }

  function saveStateToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
      console.warn("Failed to save state to localStorage:", e);
    }
  }

  function loadPlaidConnections() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PLAID_CONNECTIONS_KEY) || "[]");
      if (Array.isArray(saved)) return saved.filter(item => item?.connectionId).map(item => ({
        connectionId: String(item.connectionId),
        institution: String(item.institution || "Institution")
      }));
      return [];
    } catch {
      return [];
    }
  }

  function savePlaidConnections() {
    // Persist display metadata only. Plaid access tokens and credentials remain server/session-only.
    appState.plaidConfig.connections = plaidConnections.map(({ institution }) => ({ institution }));
    appState.plaidConfig.isConnected = plaidConnections.length > 0;
    appState.plaidConfig.institution = plaidConnections.length === 1 ? plaidConnections[0].institution : "";
    try {
      sessionStorage.setItem(PLAID_CONNECTIONS_KEY, JSON.stringify(plaidConnections));
      sessionStorage.removeItem("budgetapp_plaid_connection_id");
    } catch (error) {
      console.warn("Could not save the Plaid connection list for this browser session:", error);
    }
  }

  /**
   * Loads Demo/Mock bank data if accounts list is empty or requested by user
   */
  function loadDemoData() {
    const mock = window.PlaidModule.generateMockData();
    appState.accounts = mock.accounts;
    appState.transactions = mock.transactions;
    appState.balanceHistory = mock.balanceHistory;
    appState.accountHistory = {};
    appState.dataMode = "demo";
    saveStateToStorage();
    refreshCurrentView();
  }

  /**
   * Updates Plaid Status Badge
   */
  function updatePlaidBadge() {
    const badge = document.getElementById("plaidBadge");
    if (!badge) return;
    const connectButton = document.getElementById("btnConnectPlaidLink");
    if (connectButton) connectButton.textContent = plaidConnections.length ? "Add Institution" : "Connect Institution";
    if (appState.plaidConfig.isConnected) {
      badge.textContent = plaidConnections.length === 1
        ? `Connected: ${plaidConnections[0].institution}`
        : `Connected: ${plaidConnections.length} institutions`;
      badge.className = "plaid-badge connected";
    } else {
      badge.textContent = appState.dataMode === "plaid" ? "Saved Plaid Data" : appState.dataMode === "imported" ? "Imported Data" : "Demo Data";
      badge.className = "plaid-badge";
    }
  }

  function setPlaidStatus(message, kind = "info") {
    const status = document.getElementById("plaidStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `plaid-status ${kind}`;
    status.hidden = !message;
  }

  function applyPlaidData(data, { connectionId, institution, replaceAll = false } = {}) {
    const previousAccounts = replaceAll ? [] : (appState.accounts || []);
    const previousTransactions = replaceAll ? [] : (appState.transactions || []);
    const oldSameInstitutionIds = new Set(previousAccounts
      .filter(account => account.plaidConnectionId && account.institution === institution && account.plaidConnectionId !== connectionId)
      .map(account => account.plaidConnectionId));
    const currentConnectionAccounts = previousAccounts.filter(account =>
      account.plaidConnectionId === connectionId || oldSameInstitutionIds.has(account.plaidConnectionId)
    );
    const accounts = (data.accounts || []).map(account => {
      const subtype = account.subtype || account.type || "account";
      const name = account.name || "Bank account";
      const rawBalance = Number(account.balances?.current);
      const currentBalance = Number.isFinite(rawBalance)
        ? (account.type === "credit" ? -Math.abs(rawBalance) : rawBalance)
        : 0;
      const availableBalance = account.balances?.available == null ? currentBalance : Number(account.balances.available);
      const id = account.account_id;
      const existing = currentConnectionAccounts.find(item => item.id === id);
      return {
        id,
        name,
        officialName: account.official_name || `${subtype}${account.mask ? ` ••••${account.mask}` : ""}`,
        type: existing?.type || (account.type === "depository" && /savings|money market/i.test(subtype) ? "savings" : "spending"),
        subtype,
        plaidType: account.type,
        mask: account.mask || "",
        currentBalance,
        availableBalance,
        plaidConnectionId: connectionId,
        institution: institution || data.institution || "Institution"
      };
    });
    const transactions = (data.transactions || []).map(transaction => ({
      id: transaction.transaction_id,
      accountId: transaction.account_id,
      date: transaction.date || transaction.authorized_date,
      amount: Number(transaction.amount) || 0,
      name: transaction.merchant_name || transaction.name || "Transaction",
      category: String(transaction.personal_finance_category?.primary || transaction.category?.[0] || "other").toLowerCase().replaceAll("_", " "),
      pending: Boolean(transaction.pending),
      plaidConnectionId: connectionId
    }));
    const otherAccounts = previousAccounts.filter(account =>
      account.plaidConnectionId !== connectionId && !oldSameInstitutionIds.has(account.plaidConnectionId)
    );
    const otherTransactions = previousTransactions.filter(transaction =>
      transaction.plaidConnectionId !== connectionId && !oldSameInstitutionIds.has(transaction.plaidConnectionId)
    );
    appState.accounts = [...otherAccounts, ...accounts];
    const byTransactionId = new Map([...otherTransactions, ...transactions].map(transaction => [
      `${transaction.plaidConnectionId || "legacy"}:${transaction.id}`,
      transaction
    ]));
    appState.transactions = [...byTransactionId.values()];
    appState.dataMode = "plaid";
    rebuildBalanceHistory();
  }

  function rebuildBalanceHistory() {
    const accounts = appState.accounts || [];
    if (!accounts.length) {
      appState.accountHistory = {};
      appState.balanceHistory = [];
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayTime = Date.parse(`${today}T00:00:00Z`);
    const transactionsByAccount = new Map();
    (appState.transactions || []).forEach(transaction => {
      if (transaction.pending || !transaction.accountId || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date || "")) return;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) return;
      if (!transactionsByAccount.has(transaction.accountId)) transactionsByAccount.set(transaction.accountId, new Map());
      const dailyTotals = transactionsByAccount.get(transaction.accountId);
      dailyTotals.set(transaction.date, (dailyTotals.get(transaction.date) || 0) + amount);
    });

    const histories = {};
    accounts.forEach(account => {
      const dailyTotals = transactionsByAccount.get(account.id) || new Map();
      const dates = [...dailyTotals.keys()].filter(date => date <= today).sort();
      const startDate = dates[0] || today;
      const startTime = Date.parse(`${startDate}T00:00:00Z`);
      let balance = Number(account.currentBalance) || 0;
      const series = [];
      for (let time = todayTime; time >= startTime; time -= 86400000) {
        const date = new Date(time).toISOString().slice(0, 10);
        series.push({ date, balance: Math.round(balance * 100) / 100 });
        // Plaid transaction amounts are positive for outflows and negative for inflows.
        // Walk backward from the latest balance to estimate each prior end-of-day balance.
        balance += dailyTotals.get(date) || 0;
      }
      histories[account.id] = series.reverse();
    });
    appState.accountHistory = histories;

    // One account with limited coverage should not erase history for every other account.
    // Use the union of available dates and carry the earliest estimate for accounts that
    // have no older transaction data. The UI labels these combined values as estimates.
    const allDates = [...new Set(Object.values(histories).flat().map(point => point.date))].sort();
    const pointsByAccountAndDate = Object.fromEntries(Object.entries(histories).map(([accountId, series]) => [
      accountId,
      new Map(series.map(point => [point.date, point.balance]))
    ]));
    appState.balanceHistory = allDates.map(date => {
      const snapshot = { date, total: 0 };
      accounts.forEach(account => {
        const history = histories[account.id] || [];
        if (!history.length) return;
        const exactBalance = pointsByAccountAndDate[account.id].get(date);
        const balance = exactBalance ?? (date < history[0].date ? history[0].balance : history[history.length - 1].balance);
        snapshot[account.id] = balance;
        snapshot.total += balance;
      });
      snapshot.total = Math.round(snapshot.total * 100) / 100;
      return snapshot;
    });
  }

  async function removePlaidConnection(connectionId) {
    const connection = plaidConnections.find(item => item.connectionId === connectionId);
    if (!connection) return;
    if (!confirm(`Disconnect ${connection.institution} and remove its imported accounts and transactions from this app?`)) return;

    try { await window.PlaidModule.disconnectPlaid(connectionId); } catch { /* The server session may already have expired. */ }
    plaidConnections = plaidConnections.filter(item => item.connectionId !== connectionId);
    appState.accounts = appState.accounts.filter(account => account.plaidConnectionId !== connectionId);
    appState.transactions = appState.transactions.filter(transaction => transaction.plaidConnectionId !== connectionId);
    rebuildBalanceHistory();
    savePlaidConnections();
    saveStateToStorage();
    refreshCurrentView();
    setPlaidStatus(`${connection.institution} was disconnected.`, "info");
  }

  async function syncAllPlaidConnections() {
    const failures = [];
    let synced = 0;
    for (const connection of plaidConnections) {
      try {
        const data = await window.PlaidModule.syncPlaidData(connection.connectionId);
        applyPlaidData(data, {
          connectionId: connection.connectionId,
          institution: connection.institution,
          replaceAll: synced === 0 && appState.dataMode === "demo" && !appState.accounts.some(account => account.plaidConnectionId)
        });
        synced++;
      } catch (error) {
        failures.push(`${connection.institution}: ${error.message}`);
      }
    }
    if (synced > 0) appState.plaidConfig.lastSyncAt = new Date().toISOString();
    saveStateToStorage();
    refreshCurrentView();
    return { synced, failures };
  }

  /**
   * Reads current projection input parameters and triggers projection update
   */
  function updateProjectionView() {
    const params = {
      accountSelection: document.getElementById("projAccountSelect")?.value || "ALL",
      trainDays: document.getElementById("projTrainWindow")?.value || 90,
      modelType: document.getElementById("projModelType")?.value || "linear",
      futureMonths: document.getElementById("projFutureHorizon")?.value || 12,
      interestRate: document.getElementById("projInterestRate")?.value ?? 5.0,
      monthlyDeposit: document.getElementById("projMonthlyDeposit")?.value ?? 250
    };
    window.ProjectionModule.init(appState, params);
  }

  /**
   * Refreshes active tab view
   */
  function refreshCurrentView() {
    updatePlaidBadge();
    updateDataSourceNotice();

    if (currentTab === "summary") {
      window.SummaryModule.init(appState, summaryMonths);
    } else if (currentTab === "spending") {
      window.SpendingModule.init(appState, spendingDays);
    } else if (currentTab === "projections") {
      updateProjectionView();
    } else if (currentTab === "settings") {
      window.SettingsModule.init({ ...appState, plaidSessionConnections: plaidConnections }, {
        onAccountTypeChange: (accId, newType) => {
          const acc = appState.accounts.find(a => a.id === accId);
          if (acc) {
            acc.type = newType;
            saveStateToStorage();
          }
        },
        onDisconnect: removePlaidConnection
      });
    }
  }

  function updateDataSourceNotice() {
    const notice = document.getElementById("dataSourceNotice");
    if (!notice) return;
    notice.replaceChildren();
    notice.hidden = false;
    const text = document.createElement("span");
    const connectedInstitutions = plaidConnections.length;
    if (appState.dataMode === "demo") {
      text.textContent = "Sample data — these figures are examples, not your financial accounts.";
    } else if (connectedInstitutions) {
      const lastSync = appState.plaidConfig.lastSyncAt
        ? ` Last synced ${new Date(appState.plaidConfig.lastSyncAt).toLocaleString()}.`
        : "";
      text.textContent = `Live data from ${connectedInstitutions} institution${connectedInstitutions === 1 ? "" : "s"}.${lastSync}`;
    } else if (appState.dataMode === "plaid") {
      text.textContent = "Saved Plaid data — reconnect your institutions to refresh balances and transactions.";
    } else {
      text.textContent = "Imported data — these figures came from a local backup.";
    }
    notice.appendChild(text);
    if (!connectedInstitutions) {
      const settingsButton = document.createElement("button");
      settingsButton.type = "button";
      settingsButton.className = "notice-action";
      settingsButton.textContent = "Connect an institution";
      settingsButton.addEventListener("click", () => document.querySelector('.nav-btn[data-tab="settings"]')?.click());
      notice.appendChild(settingsButton);
    }
  }

  /**
   * Tab Switcher Handler
   */
  function setupTabNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    navButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        if (!targetTab) return;

        currentTab = targetTab;

        // Update nav button active states
        navButtons.forEach(b => b.classList.remove("active"));
        navButtons.forEach(b => b.removeAttribute("aria-current"));
        btn.classList.add("active");
        btn.setAttribute("aria-current", "page");

        // Update tab container active states
        tabContents.forEach(tc => {
          if (tc.id === `tab-${targetTab}`) {
            tc.classList.add("active");
          } else {
            tc.classList.remove("active");
          }
        });

        refreshCurrentView();
      });
    });
  }

  /**
   * Attach Event Listeners across Tabs & Settings
   */
  function setupEventListeners() {
    // Demo Data Button (in Settings Data Management)
    document.getElementById("btnQuickDemo")?.addEventListener("click", () => {
      if (!confirm("Load sample data and replace the accounts and transactions currently shown in this app? Export a backup first if you want to keep them.")) return;
      loadDemoData();
      setSettingsStatus("Sample data loaded. It replaces the current account data shown in the app.", "success");
    });

    // Tab 1: Summary Time Filter Buttons
    const sumTimeContainer = document.getElementById("summaryTimeFilters");
    if (sumTimeContainer) {
      sumTimeContainer.querySelectorAll(".btn").forEach(btn => {
        btn.addEventListener("click", () => {
          sumTimeContainer.querySelectorAll(".btn").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-pressed", "false");
          });
          btn.classList.add("active");
          btn.setAttribute("aria-pressed", "true");
          summaryMonths = Number(btn.getAttribute("data-months")) || 0;
          window.SummaryModule.renderMainBalanceChart(appState, summaryMonths);
          window.SummaryModule.updateExpandedAccountCharts(appState, summaryMonths);
        });
      });
    }

    // Tab 2: Spending Time Filter Buttons
    const spendTimeContainer = document.getElementById("spendingTimeFilters");
    if (spendTimeContainer) {
      spendTimeContainer.querySelectorAll(".btn").forEach(btn => {
        btn.addEventListener("click", () => {
          spendTimeContainer.querySelectorAll(".btn").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-pressed", "false");
          });
          btn.classList.add("active");
          btn.setAttribute("aria-pressed", "true");
          spendingDays = Number(btn.getAttribute("data-days")) || 90;
          window.SpendingModule.init(appState, spendingDays);
        });
      });
    }

    // Tab 2 Quick Edit Budgets Button -> Switches to Tab 4 Settings
    document.getElementById("btnEditBudgetsQuick")?.addEventListener("click", () => {
      document.querySelector('.nav-btn[data-tab="settings"]')?.click();
    });

    // Tab 3: Projection Inputs - Live Updates on Change/Input
    const projInputIds = [
      "projAccountSelect",
      "projTrainWindow",
      "projModelType",
      "projFutureHorizon",
      "projInterestRate",
      "projMonthlyDeposit"
    ];

    projInputIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const eventType = (el.tagName === "INPUT") ? "input" : "change";
      el.addEventListener(eventType, () => {
        if (id === "projModelType") {
          const expContainer = document.getElementById("exponentialParams");
          if (expContainer) {
            expContainer.style.display = el.value === "exponential" ? "block" : "none";
          }
        }
        if (currentTab === "projections") {
          updateProjectionView();
        }
      });
    });

    // Prevent form default submit for projections form
    document.getElementById("formProjections")?.addEventListener("submit", (e) => {
      e.preventDefault();
      updateProjectionView();
    });

    // The secret remains out of browser storage; the server updates it only inside the encrypted local vault.
    document.getElementById("formPlaidSettings")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clientId = document.getElementById("plaidClientId").value.trim();
      const secret = document.getElementById("plaidSecret").value.trim();
      const env = document.getElementById("plaidEnv").value;
      if (!clientId || !secret) {
        setPlaidStatus("Enter both your Plaid Client ID and Secret before saving.", "error");
        return;
      }
      const identityChanged = clientId !== appState.plaidConfig.clientId || env !== appState.plaidConfig.env;
      let credentialsUpdatedForAllConnections = true;
      if (identityChanged && plaidConnections.length) {
        const disconnectFailures = [];
        for (const connection of plaidConnections) {
          try { await window.PlaidModule.disconnectPlaid(connection.connectionId); }
          catch { disconnectFailures.push(connection); }
        }
        plaidConnections = disconnectFailures;
        try { sessionStorage.removeItem("budgetapp_plaid_connection_id"); } catch { /* Storage may be unavailable. */ }
        savePlaidConnections();
        if (disconnectFailures.length) {
          setPlaidStatus("Could not remove every saved connection. Check the local server and retry before changing Plaid environments.", "error");
          return;
        }
      } else if (plaidConnections.length) {
        try {
          const result = await window.PlaidModule.updateSavedCredentials({ clientId, secret, env });
          credentialsUpdatedForAllConnections = result.updated === plaidConnections.length;
        } catch (error) {
          setPlaidStatus(error.message || "Could not update saved Plaid credentials.", "error");
          return;
        }
      }
      appState.plaidConfig.clientId = clientId;
      plaidSecret = secret;
      appState.plaidConfig.env = env;
      saveStateToStorage();
      setPlaidStatus(plaidConnections.length
        ? credentialsUpdatedForAllConnections
          ? "Credentials saved for this session and updated in the encrypted local vault. Existing institutions should reconnect automatically after app restarts."
          : "Credentials saved. Some institutions use different Plaid credentials and may need to be reconnected."
        : "Credentials saved for this browser session. Connect an institution with Plaid Link, then use Add Institution for another bank.", "info");
    });

    // Plaid Link creates a short-lived token, then exchanges and syncs through the local server.
    document.getElementById("btnConnectPlaidLink")?.addEventListener("click", async () => {
      const button = document.getElementById("btnConnectPlaidLink");
      if (!appState.plaidConfig.clientId || !plaidSecret) {
        setPlaidStatus("Save your Plaid Client ID and Secret first. They are only kept in memory for this session.", "error");
        document.getElementById("plaidClientId")?.focus();
        return;
      }
      button.disabled = true;
      button.textContent = "Preparing Plaid Link…";
      setPlaidStatus("Connecting securely to Plaid…", "info");
      try {
        await window.PlaidModule.launchPlaidLink(
          {
            clientId: appState.plaidConfig.clientId,
            secret: plaidSecret,
            env: appState.plaidConfig.env
          },
          async (data, metadata, connectionId, connectionInfo) => {
            setPlaidStatus("Bank connected. Loading accounts and transactions…", "info");
            const institution = metadata?.institution?.name || "your bank";
            const alreadyConnected = plaidConnections.length > 0;
            plaidConnections = [...plaidConnections.filter(item => item.connectionId !== connectionId), { connectionId, institution }];
            savePlaidConnections();
            appState.dataMode = "plaid";
            if (!data.syncError) {
              appState.plaidConfig.lastSyncAt = new Date().toISOString();
              const hasPreviousPlaidData = appState.accounts.some(account => account.plaidConnectionId);
              applyPlaidData(data, { connectionId, institution, replaceAll: !alreadyConnected && !hasPreviousPlaidData });
            }
            saveStateToStorage();
            refreshCurrentView();
            if (data.syncError) {
              setPlaidStatus(`Connected to ${institution}, but Plaid is still preparing transaction history. Use Fetch / Sync Plaid Data shortly. ${data.syncError}`, "info");
            } else if (!connectionInfo?.persisted) {
              setPlaidStatus(`Connected to ${institution}, but the encrypted connection could not be saved. It will be lost when the server stops. Check the server log and try again.`, "error");
            } else {
              setPlaidStatus(`Connected to ${institution}. The secure connection is saved and will be restored when the app restarts.`, "success");
            }
          },
          (error) => {
            if (error) setPlaidStatus(error.message || "Plaid Link closed with an error. Please try again.", "error");
            else setPlaidStatus("Plaid Link was closed before the bank connection finished.", "info");
          },
          (eventName) => {
            if (eventName === "OPEN") {
              setPlaidStatus("Plaid Link is open. Follow the Plaid prompts to choose your bank.", "info");
            }
          }
        );
      } catch (error) {
        setPlaidStatus(error.message || "Could not start Plaid Link.", "error");
      } finally {
        button.disabled = false;
        button.textContent = plaidConnections.length ? "Add Institution" : "Connect Institution";
      }
    });

    document.getElementById("btnSyncPlaidData")?.addEventListener("click", async () => {
      if (!plaidConnections.length) {
        setPlaidStatus("Connect an institution with Plaid Link before syncing.", "error");
        return;
      }
      const button = document.getElementById("btnSyncPlaidData");
      button.disabled = true;
      button.textContent = "Syncing…";
      setPlaidStatus("Fetching transaction history and rebuilding balance charts…", "info");
      try {
        const { synced, failures } = await syncAllPlaidConnections();
        if (failures.length) {
          setPlaidStatus(`Synced ${synced} of ${plaidConnections.length} institutions. ${failures.join("; ")}`, "error");
        } else {
          setPlaidStatus(`Synced ${synced} institution${synced === 1 ? "" : "s"}. Accounts and transactions are up to date.`, "success");
        }
      } catch (error) {
        setPlaidStatus(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Fetch / Sync Plaid Data";
      }
    });

    // Tab 4: Save Budget Goals
    document.getElementById("formBudgetGoals")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inputs = document.querySelectorAll(".budget-goal-input");
      let invalid = false;
      inputs.forEach(inp => {
        const cat = inp.getAttribute("data-cat");
        const val = Number(inp.value);
        if (!Number.isFinite(val) || val < 0) {
          invalid = true;
          return;
        }
        appState.budgets[cat] = val;
      });
      if (invalid) {
        setSettingsStatus("Enter a valid non-negative amount for each budget goal.", "error");
        return;
      }
      saveStateToStorage();
      setSettingsStatus("Budget goals saved.", "success");
    });

    // Tab 4: Keyword Rules Add/Save Buttons
    document.getElementById("btnAddKeywordRule")?.addEventListener("click", () => {
      window.SettingsModule.addKeywordRuleRow();
    });

    document.getElementById("btnSaveKeywordRules")?.addEventListener("click", () => {
      const rules = window.SettingsModule.getKeywordRulesFromDOM();
      appState.keywordRules = rules;
      saveStateToStorage();
      setSettingsStatus("Category rules saved.", "success");
    });

    // Tab 4: Export Data
    document.getElementById("btnExportData")?.addEventListener("click", () => {
      const backup = JSON.parse(JSON.stringify(appState));
      delete backup.plaidConfig?.clientId;
      delete backup.plaidConfig?.secret;
      delete backup.plaidConfig?.accessToken;
      delete backup.plaidConfig?.connectionId;
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `barebones_budget_backup_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Tab 4: Import Data
    const importInput = document.getElementById("importFileInput");
    document.getElementById("btnImportData")?.addEventListener("click", () => {
      importInput?.click();
    });

    importInput?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("Importing this backup replaces the account data currently shown in the app. Continue?")) {
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          const valid = imported && typeof imported === "object" && Array.isArray(imported.accounts) &&
            imported.accounts.every(account => account && typeof account === "object" && account.id != null) &&
            Array.isArray(imported.transactions || []) && (imported.transactions || []).every(transaction => transaction && typeof transaction === "object") &&
            Array.isArray(imported.balanceHistory || []) && (imported.balanceHistory || []).every(point => point && typeof point === "object");
          if (valid) {
            await Promise.all(plaidConnections.map(connection => window.PlaidModule.disconnectPlaid(connection.connectionId).catch(() => {})));
            appState = { ...appState, ...imported };
            appState.plaidConfig = { ...appState.plaidConfig, ...(imported.plaidConfig || {}) };
            delete appState.plaidConfig.secret;
            delete appState.plaidConfig.accessToken;
            delete appState.plaidConfig.connectionId;
            appState.plaidConfig.clientId = "";
            appState.plaidConfig.env = ["sandbox", "development", "production"].includes(appState.plaidConfig.env)
              ? appState.plaidConfig.env
              : "sandbox";
            appState.plaidConfig.connections = [];
            appState.plaidConfig.isConnected = false;
            appState.accountHistory = imported.accountHistory && typeof imported.accountHistory === "object" ? imported.accountHistory : {};
            appState.budgets = { ...appState.budgets, ...(imported.budgets || {}) };
            appState.keywordRules = Array.isArray(imported.keywordRules)
              ? imported.keywordRules.filter(rule => rule && typeof rule.keyword === "string" && ["rent", "groceries", "utilities", "leisure", "travel", "other"].includes(rule.category))
              : appState.keywordRules;
            appState.dataMode = "imported";
            plaidConnections = [];
            try { sessionStorage.removeItem(PLAID_CONNECTIONS_KEY); } catch { /* Storage may be unavailable. */ }
            saveStateToStorage();
            refreshCurrentView();
            setSettingsStatus("Data imported. Plaid access is not included in backups; reconnect to refresh live data.", "success");
          } else {
            setSettingsStatus("Invalid backup file. Choose a JSON backup exported by this app.", "error");
          }
        } catch (err) {
          setSettingsStatus("Could not read that file as a valid app backup.", "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    // Tab 4: Reset Data
    document.getElementById("btnResetData")?.addEventListener("click", async () => {
      if (confirm("Are you sure you want to reset all data? This will clear all accounts, transactions, and settings.")) {
        await Promise.all(plaidConnections.map(connection => window.PlaidModule.disconnectPlaid(connection.connectionId).catch(() => {})));
        try {
          sessionStorage.removeItem(PLAID_CONNECTIONS_KEY);
          sessionStorage.removeItem("budgetapp_plaid_connection_id");
        } catch { /* Continue with the local data reset when session storage is unavailable. */ }
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
  }

  function setSettingsStatus(message, kind = "info") {
    const status = document.getElementById("settingsStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `plaid-status ${kind}`;
    status.hidden = !message;
  }

  /**
   * App Initialization Entry Point
   */
  async function initApp() {
    loadStateFromStorage();

    let serverConnectionList = null;
    try {
      serverConnectionList = await window.PlaidModule.getConnections();
    } catch { /* Older server processes do not expose persistent connection recovery yet. */ }
    const restoredFromServer = Array.isArray(serverConnectionList?.connections);
    if (restoredFromServer) {
      plaidConnections = serverConnectionList.connections;
      if (serverConnectionList.warning) setPlaidStatus(serverConnectionList.warning, "error");
    } else {
      plaidConnections = loadPlaidConnections();
      if (!plaidConnections.length) {
        try {
          const legacyId = sessionStorage.getItem("budgetapp_plaid_connection_id") || "";
          if (legacyId) plaidConnections = [{ connectionId: legacyId, institution: appState.plaidConfig.institution || "Institution" }];
        } catch { /* A private browsing session may disable sessionStorage. */ }
      }
    }
    if (!restoredFromServer && plaidConnections.length) {
      const active = [];
      for (const connection of plaidConnections) {
        try {
          const status = await window.PlaidModule.getConnectionStatus(connection.connectionId);
          if (status.connected) active.push(connection);
        } catch { /* The server may have restarted and lost its in-memory connections. */ }
      }
      plaidConnections = active;
      if (plaidConnections.length === 1) {
        const legacyConnection = plaidConnections[0];
        appState.accounts = appState.accounts.map(account => account.plaidConnectionId ? account : {
          ...account,
          plaidConnectionId: legacyConnection.connectionId,
          institution: legacyConnection.institution
        });
        appState.transactions = appState.transactions.map(transaction => transaction.plaidConnectionId ? transaction : {
          ...transaction,
          plaidConnectionId: legacyConnection.connectionId
        });
      }
    }
    if (restoredFromServer || plaidConnections.length) savePlaidConnections();
    if (plaidConnections.length) {
      if (!appState.accounts.length || appState.accounts.some(account => account.plaidConnectionId)) appState.dataMode = "plaid";
      saveStateToStorage();
    } else if (restoredFromServer && serverConnectionList.warning) {
      setPlaidStatus(`${serverConnectionList.warning} Reconnect each institution to save it again.`, "error");
    } else if (appState.dataMode === "plaid" && appState.accounts.some(account => account.plaidConnectionId)) {
      setPlaidStatus("Your saved account history is still available. Connect each institution once to enable encrypted connection recovery across app restarts.", "info");
    }

    // If initial start has no accounts, load demo data so app is immediately interactive!
    if ((!appState.accounts || appState.accounts.length === 0) && !plaidConnections.length) {
      loadDemoData();
    } else {
      refreshCurrentView();
    }

    setupTabNavigation();
    setupEventListeners();
    if (plaidConnections.length) {
      setPlaidStatus("Refreshing institution transactions and rebuilding historical balances…", "info");
      syncAllPlaidConnections().then(({ synced, failures }) => {
        if (failures.length) {
          setPlaidStatus(`Updated ${synced} institutions. ${failures.join("; ")}`, "error");
        } else {
          setPlaidStatus(`Historical balances updated from ${synced} institution${synced === 1 ? "" : "s"}.`, "success");
        }
      });
    }
    window.PlaidModule.checkService().then(available => {
      if (!available && !appState.plaidConfig.isConnected) {
        setPlaidStatus("Plaid's local service is not running. Start it from the app folder with `node server.js`, keep that terminal open, then retry.", "error");
      }
    });
  }

  // Run when DOM content is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
