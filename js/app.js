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
      connectionId: "",
      institution: "",
      isConnected: false
    },
    accounts: [],
    transactions: [],
    balanceHistory: [],
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
  let plaidConnectionId = "";

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
        // Older versions stored secrets and fake access tokens in localStorage. Drop them on load.
        delete appState.plaidConfig.secret;
        delete appState.plaidConfig.accessToken;
        delete appState.plaidConfig.connectionId;
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

  /**
   * Loads Demo/Mock bank data if accounts list is empty or requested by user
   */
  function loadDemoData() {
    const mock = window.PlaidModule.generateMockData();
    appState.accounts = mock.accounts;
    appState.transactions = mock.transactions;
    appState.balanceHistory = mock.balanceHistory;
    saveStateToStorage();
    refreshCurrentView();
  }

  /**
   * Updates Plaid Status Badge
   */
  function updatePlaidBadge() {
    const badge = document.getElementById("plaidBadge");
    if (!badge) return;
    if (appState.plaidConfig.isConnected) {
      badge.textContent = appState.plaidConfig.institution ? `Connected: ${appState.plaidConfig.institution}` : "Plaid Connected";
      badge.className = "plaid-badge connected";
    } else {
      badge.textContent = "Mock Mode";
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

  function applyPlaidData(data) {
    const accounts = (data.accounts || []).map(account => {
      const subtype = account.subtype || account.type || "account";
      const name = account.name || "Bank account";
      const currentBalance = Number(account.balances?.current) || 0;
      const availableBalance = account.balances?.available == null ? currentBalance : Number(account.balances.available);
      const id = account.account_id;
      return {
        id,
        name,
        officialName: account.official_name || `${subtype}${account.mask ? ` ••••${account.mask}` : ""}`,
        type: account.type === "depository" && /savings|money market/i.test(subtype) ? "savings" : "spending",
        subtype,
        mask: account.mask || "",
        currentBalance,
        availableBalance
      };
    });
    const transactions = (data.transactions || []).map(transaction => ({
      id: transaction.transaction_id,
      accountId: transaction.account_id,
      date: transaction.date || transaction.authorized_date,
      amount: Number(transaction.amount) || 0,
      name: transaction.merchant_name || transaction.name || "Transaction",
      category: String(transaction.personal_finance_category?.primary || transaction.category?.[0] || "other").toLowerCase().replaceAll("_", " ")
    }));
    const date = new Date().toISOString().slice(0, 10);
    const snapshot = { date, total: accounts.reduce((sum, account) => sum + account.currentBalance, 0) };
    accounts.forEach(account => { snapshot[account.id] = account.currentBalance; });
    appState.accounts = accounts;
    appState.transactions = transactions;
    appState.balanceHistory = accounts.length ? [snapshot] : [];
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
      interestRate: document.getElementById("projInterestRate")?.value || 5.0,
      monthlyDeposit: document.getElementById("projMonthlyDeposit")?.value || 250
    };
    window.ProjectionModule.init(appState, params);
  }

  /**
   * Refreshes active tab view
   */
  function refreshCurrentView() {
    updatePlaidBadge();

    if (currentTab === "summary") {
      window.SummaryModule.init(appState, summaryMonths);
    } else if (currentTab === "spending") {
      window.SpendingModule.init(appState, spendingDays);
    } else if (currentTab === "projections") {
      updateProjectionView();
    } else if (currentTab === "settings") {
      window.SettingsModule.init(appState, {
        onAccountTypeChange: (accId, newType) => {
          const acc = appState.accounts.find(a => a.id === accId);
          if (acc) {
            acc.type = newType;
            saveStateToStorage();
          }
        }
      });
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
        btn.classList.add("active");

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
      loadDemoData();
      alert("Loaded demo bank accounts, balance history, and transactions.");
    });

    // Tab 1: Summary Time Filter Buttons
    const sumTimeContainer = document.getElementById("summaryTimeFilters");
    if (sumTimeContainer) {
      sumTimeContainer.querySelectorAll(".btn").forEach(btn => {
        btn.addEventListener("click", () => {
          sumTimeContainer.querySelectorAll(".btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          summaryMonths = Number(btn.getAttribute("data-months")) || 0;
          window.SummaryModule.renderMainBalanceChart(appState, summaryMonths);
        });
      });
    }

    // Tab 2: Spending Time Filter Buttons
    const spendTimeContainer = document.getElementById("spendingTimeFilters");
    if (spendTimeContainer) {
      spendTimeContainer.querySelectorAll(".btn").forEach(btn => {
        btn.addEventListener("click", () => {
          spendTimeContainer.querySelectorAll(".btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
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

    // Plaid settings are kept in memory only; the server never saves credentials to browser storage.
    document.getElementById("formPlaidSettings")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clientId = document.getElementById("plaidClientId").value.trim();
      const secret = document.getElementById("plaidSecret").value.trim();
      const env = document.getElementById("plaidEnv").value;
      if (!clientId || !secret) {
        setPlaidStatus("Enter both your Plaid Client ID and Secret before saving.", "error");
        return;
      }
      const credentialsChanged = clientId !== appState.plaidConfig.clientId || secret !== plaidSecret || env !== appState.plaidConfig.env;
      if (credentialsChanged && plaidConnectionId) {
        try { await window.PlaidModule.disconnectPlaid(plaidConnectionId); } catch { /* Expired server sessions are safe to discard. */ }
        plaidConnectionId = "";
        sessionStorage.removeItem("budgetapp_plaid_connection_id");
        appState.plaidConfig.isConnected = false;
        appState.plaidConfig.institution = "";
      }
      appState.plaidConfig.clientId = clientId;
      plaidSecret = secret;
      appState.plaidConfig.env = env;
      saveStateToStorage();
      setPlaidStatus("Credentials saved for this browser session. Launch Plaid Link to connect a bank.", "info");
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
          async (data, metadata, connectionId) => {
            setPlaidStatus("Bank connected. Loading accounts and transactions…", "info");
            const institution = metadata?.institution?.name || "your bank";
            applyPlaidData(data);
            plaidConnectionId = connectionId;
            sessionStorage.setItem("budgetapp_plaid_connection_id", connectionId);
            appState.plaidConfig.institution = institution;
            appState.plaidConfig.isConnected = true;
            saveStateToStorage();
            refreshCurrentView();
            setPlaidStatus(`Connected to ${institution}. Accounts and transactions are up to date.`, "success");
          },
          (error) => {
            if (error) setPlaidStatus(error.message || "Plaid Link closed with an error. Please try again.", "error");
            else setPlaidStatus("Plaid Link was closed before the bank connection finished.", "info");
          }
        );
      } catch (error) {
        setPlaidStatus(error.message || "Could not start Plaid Link.", "error");
      } finally {
        button.disabled = false;
        button.textContent = "Launch Plaid Link";
      }
    });

    document.getElementById("btnSyncPlaidData")?.addEventListener("click", async () => {
      if (!plaidConnectionId) {
        setPlaidStatus("Connect a bank with Plaid Link before syncing.", "error");
        return;
      }
      const button = document.getElementById("btnSyncPlaidData");
      button.disabled = true;
      button.textContent = "Syncing…";
      setPlaidStatus("Fetching the latest accounts and transactions…", "info");
      try {
        const data = await window.PlaidModule.syncPlaidData(plaidConnectionId);
        applyPlaidData(data);
        saveStateToStorage();
        refreshCurrentView();
        setPlaidStatus("Accounts and transactions are up to date.", "success");
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
      inputs.forEach(inp => {
        const cat = inp.getAttribute("data-cat");
        const val = Number(inp.value) || 0;
        appState.budgets[cat] = val;
      });
      saveStateToStorage();
      alert("Budget goals saved successfully.");
    });

    // Tab 4: Keyword Rules Add/Save Buttons
    document.getElementById("btnAddKeywordRule")?.addEventListener("click", () => {
      window.SettingsModule.addKeywordRuleRow();
    });

    document.getElementById("btnSaveKeywordRules")?.addEventListener("click", () => {
      const rules = window.SettingsModule.getKeywordRulesFromDOM();
      appState.keywordRules = rules;
      saveStateToStorage();
      alert("Category keyword rules saved.");
    });

    // Tab 4: Export Data
    document.getElementById("btnExportData")?.addEventListener("click", () => {
      const jsonStr = JSON.stringify(appState, null, 2);
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
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          if (imported && imported.accounts) {
            appState = imported;
            saveStateToStorage();
            refreshCurrentView();
            alert("Data imported successfully.");
          } else {
            alert("Invalid JSON data format.");
          }
        } catch (err) {
          alert("Failed to parse JSON file.");
        }
      };
      reader.readAsText(file);
    });

    // Tab 4: Reset Data
    document.getElementById("btnResetData")?.addEventListener("click", () => {
      if (confirm("Are you sure you want to reset all data? This will clear all accounts, transactions, and settings.")) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
  }

  /**
   * App Initialization Entry Point
   */
  async function initApp() {
    loadStateFromStorage();

    try { plaidConnectionId = sessionStorage.getItem("budgetapp_plaid_connection_id") || ""; } catch { plaidConnectionId = ""; }
    if (plaidConnectionId) {
      try {
        const connection = await window.PlaidModule.getConnectionStatus(plaidConnectionId);
        appState.plaidConfig.isConnected = Boolean(connection.connected);
        if (!connection.connected) {
          plaidConnectionId = "";
          sessionStorage.removeItem("budgetapp_plaid_connection_id");
          setPlaidStatus("Your Plaid server session has expired. Save your credentials again and reconnect the bank.", "info");
        }
      } catch {
        appState.plaidConfig.isConnected = false;
        plaidConnectionId = "";
        sessionStorage.removeItem("budgetapp_plaid_connection_id");
        setPlaidStatus("Could not restore the Plaid session. Save your credentials and reconnect the bank.", "info");
      }
    }

    // If initial start has no accounts, load demo data so app is immediately interactive!
    if (!appState.accounts || appState.accounts.length === 0) {
      loadDemoData();
    } else {
      refreshCurrentView();
    }

    setupTabNavigation();
    setupEventListeners();
  }

  // Run when DOM content is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
