/**
 * Tab 1: Account Summary & Interactive Line Charts Module
 */
window.SummaryModule = (function () {
  let mainChart = null;
  const accountCharts = {}; // Map of accountId -> Chart instance
  const { formatCurrency, escapeHtml } = window.AppUtils;

  /**
   * Filters balance history by target months (0 = All)
   */
  function getFilteredHistory(history, targetMonths) {
    if (!history || history.length === 0) return [];
    if (!targetMonths || targetMonths === 0) return history;

    // Anchor relative windows to the newest point in the series. Imported and
    // Plaid histories may stop before today, so a wall-clock cutoff can leave
    // the chart with no data (or make a caller fall back to the full history).
    const latestDate = history.reduce((latest, item) => item.date > latest ? item.date : latest, history[0].date);
    const cutoff = new Date(`${latestDate}T12:00:00`);
    const dayOfMonth = cutoff.getDate();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - targetMonths);
    const lastDayOfTargetMonth = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
    cutoff.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

    return history.filter(item => item.date >= cutoffStr);
  }

  /**
   * Renders high-level overview metrics
   */
  function renderOverviewStats(state) {
    const accounts = state.accounts || [];
    let total = 0;
    let savings = 0;
    let spending = 0;

    accounts.forEach(acc => {
      const bal = Number(acc.currentBalance) || 0;
      total += bal;
      if (acc.type === "savings") {
        savings += bal;
      } else {
        spending += bal;
      }
    });

    document.getElementById("statTotalBalance").textContent = formatCurrency(total);
    document.getElementById("statSavingsBalance").textContent = formatCurrency(savings);
    document.getElementById("statSpendingBalance").textContent = formatCurrency(spending);
  }

  /**
   * Renders main Balance vs Time Chart.js line plot
   */
  function renderMainBalanceChart(state, targetMonths = 3) {
    const ctx = document.getElementById("summaryBalanceChart");
    if (!ctx) return;

    const filteredHistory = getFilteredHistory(state.balanceHistory || [], targetMonths);
    const labels = filteredHistory.map(item => item.date);
    const data = filteredHistory.map(item => item.total);
    const emptyState = document.getElementById("summaryHistoryEmpty");
    const hasHistory = labels.length > 1;
    const canRenderChart = hasHistory && typeof Chart !== "undefined";
    ctx.hidden = !canRenderChart;
    if (emptyState) {
      emptyState.hidden = canRenderChart;
      emptyState.textContent = typeof Chart === "undefined"
        ? "Charts could not load. Check your internet connection and reload the app."
        : labels.length
          ? "Only one historical balance is available. Sync more transactions to build a trend."
          : "No balance history is available yet. Connect an institution and sync transactions to build a trend.";
    }

    if (mainChart) {
      mainChart.destroy();
      mainChart = null;
    }
    if (!canRenderChart) return;

    mainChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Total Balance ($)",
          data: data,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.25,
          pointRadius: labels.length > 90 ? 0 : 2,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              label: (ctx) => ` Balance: ${formatCurrency(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: "#2d323e" },
            ticks: { color: "#9aa0a6", maxTicksLimit: 8 }
          },
          y: {
            grid: { color: "#2d323e" },
            ticks: {
              color: "#9aa0a6",
              callback: (val) => "$" + val.toLocaleString()
            }
          }
        }
      }
    });
  }

  /**
   * Renders the Accounts list and setup expandable items with individual charts
   */
  function renderAccountsList(state, targetMonths) {
    const container = document.getElementById("accountsListContainer");
    if (!container) return;
    Object.values(accountCharts).forEach(chart => chart?.destroy());
    Object.keys(accountCharts).forEach(accountId => delete accountCharts[accountId]);

    const accounts = state.accounts || [];
    if (accounts.length === 0) {
      container.innerHTML = `<div style="padding:16px; color:var(--text-muted); text-align:center;">No accounts connected.</div>`;
      return;
    }

    let html = "";
    accounts.forEach(acc => {
      const typeBadgeClass = acc.type === "savings" ? "badge-savings" : "badge-spending";
      html += `
        <div class="account-item" data-acc-id="${escapeHtml(acc.id)}">
          <button type="button" class="account-header" aria-expanded="false" aria-controls="details-${escapeHtml(acc.id)}">
            <span class="account-info">
              <span class="account-name">
                ${escapeHtml(acc.name)}
                <span class="badge-tag ${typeBadgeClass}">${escapeHtml(acc.type)}</span>
              </span>
              <span class="account-meta">${escapeHtml(acc.officialName || acc.subtype || "")}</span>
            </span>
            <span class="account-balance" style="color: ${acc.currentBalance < 0 ? 'var(--accent-danger)' : 'var(--text-main)'}">
              ${formatCurrency(acc.currentBalance)}
            </span>
          </button>
          <div class="account-details" id="details-${escapeHtml(acc.id)}">
            <div style="font-size:0.8rem; font-weight:600; margin-bottom:6px; color:var(--text-muted);">
              Historical Balance Chart
            </div>
            <div class="chart-container" style="height:200px;">
              <canvas id="chart-${escapeHtml(acc.id)}"></canvas>
              <p class="account-history-empty" hidden></p>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click listeners to expand account details
    container.querySelectorAll(".account-header").forEach(header => {
      header.addEventListener("click", () => {
        const item = header.closest(".account-item");
        const accId = item.getAttribute("data-acc-id");
        const details = document.getElementById(`details-${accId}`);
        const isOpen = details.classList.contains("open");

        // Toggle visibility
        if (isOpen) {
          details.classList.remove("open");
          header.setAttribute("aria-expanded", "false");
        } else {
          details.classList.add("open");
          header.setAttribute("aria-expanded", "true");
          renderIndividualAccountChart(accId, state, targetMonths);
        }
      });
    });
  }

  /**
   * Renders individual line chart for an expanded account
   */
  function renderIndividualAccountChart(accId, state, targetMonths = 0) {
    const canvasId = `chart-${accId}`;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (accountCharts[accId]) {
      accountCharts[accId].destroy();
    }

    const history = getFilteredHistory(
      state.accountHistory?.[accId] || (state.balanceHistory || []).filter(item => item[accId] !== undefined),
      targetMonths
    );
    const labels = history.map(item => item.date);
    const data = history.map(item => item.balance ?? item[accId] ?? 0);
    const emptyState = ctx.parentElement.querySelector(".account-history-empty");
    if (labels.length < 2 || typeof Chart === "undefined") {
      ctx.hidden = true;
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = labels.length < 2
          ? "Not enough transaction history is available for this account yet."
          : "Charts could not load. Check your internet connection and reload the app.";
      }
      return;
    }
    ctx.hidden = false;
    if (emptyState) emptyState.hidden = true;

    accountCharts[accId] = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Balance",
          data: data,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.2,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Balance: ${formatCurrency(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: "#2d323e" },
            ticks: { color: "#9aa0a6", maxTicksLimit: 6 }
          },
          y: {
            grid: { color: "#2d323e" },
            ticks: { color: "#9aa0a6" }
          }
        }
      }
    });
  }

  /**
   * Full tab initialization
   */
  function init(state, selectedMonths = 3) {
    renderOverviewStats(state);
    renderMainBalanceChart(state, selectedMonths);
    renderAccountsList(state, selectedMonths);
  }

  function updateExpandedAccountCharts(state, selectedMonths) {
    document.querySelectorAll(".account-item").forEach(item => {
      const details = item.querySelector(".account-details");
      if (details?.classList.contains("open")) {
        renderIndividualAccountChart(item.getAttribute("data-acc-id"), state, selectedMonths);
      }
    });
  }

  return {
    init,
    renderMainBalanceChart,
    updateExpandedAccountCharts
  };
})();
