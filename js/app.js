/**
 * Main Application Orchestrator & LocalStorage State Manager
 */
(function () {
  const STORAGE_KEY = "barebones_finance_app_state_v1";

  // Default initial global state
  let appState = {
    plaidConfig: {
      clientId: "",
      secret: "",
      env: "sandbox",
      accessToken: "",
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

  /**
   * LocalStorage Helpers
   */
  function loadStateFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        appState = { ...appState, ...parsed };
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
      badge.textContent = "Plaid Connected";
      badge.className = "plaid-badge connected";
    } else {
      badge.textContent = "Mock Mode";
      badge.className = "plaid-badge";
    }
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

    // Tab 4: Plaid Form Submit
    document.getElementById("formPlaidSettings")?.addEventListener("submit", (e) => {
      e.preventDefault();
      appState.plaidConfig.clientId = document.getElementById("plaidClientId").value.trim();
      appState.plaidConfig.secret = document.getElementById("plaidSecret").value.trim();
      appState.plaidConfig.env = document.getElementById("plaidEnv").value;
      appState.plaidConfig.accessToken = document.getElementById("plaidAccessToken").value.trim();
      
      if (appState.plaidConfig.clientId && appState.plaidConfig.accessToken) {
        appState.plaidConfig.isConnected = true;
      }
      
      saveStateToStorage();
      updatePlaidBadge();
      alert("Plaid settings saved successfully.");
    });

    // Tab 4: Launch Plaid Link
    document.getElementById("btnConnectPlaidLink")?.addEventListener("click", () => {
      window.PlaidModule.launchPlaidLink(
        (public_token, metadata) => {
          appState.plaidConfig.accessToken = `access-sandbox-${Date.now()}`;
          appState.plaidConfig.isConnected = true;
          saveStateToStorage();
          updatePlaidBadge();
          alert(`Successfully connected account: ${metadata.institution.name}. Synchronizing transactions...`);
          if (appState.accounts.length === 0) {
            loadDemoData();
          }
        },
        (err) => {
          console.log("Plaid Link closed");
        }
      );
    });

    // Tab 4: Sync Plaid Data Button
    document.getElementById("btnSyncPlaidData")?.addEventListener("click", () => {
      alert("Plaid Sync: Synchronized latest balance snapshots and transactions.");
      if (appState.accounts.length === 0) {
        loadDemoData();
      } else {
        saveStateToStorage();
        refreshCurrentView();
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
  function initApp() {
    loadStateFromStorage();

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
