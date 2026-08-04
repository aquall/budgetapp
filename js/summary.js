/**
 * Tab 1: Account Summary & Interactive Line Charts Module
 */
window.SummaryModule = (function () {
  let mainChart = null;
  const accountCharts = {}; // Map of accountId -> Chart instance

  /**
   * Formats numbers to currency string
   */
  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return (num < 0 ? "-" : "") + "$" + Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Filters balance history by target months (0 = All)
   */
  function getFilteredHistory(history, targetMonths) {
    if (!history || history.length === 0) return [];
    if (!targetMonths || targetMonths === 0) return history;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - targetMonths);
    const cutoffStr = cutoff.toISOString().split("T")[0];

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

    if (mainChart) {
      mainChart.destroy();
    }

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
  function renderAccountsList(state) {
    const container = document.getElementById("accountsListContainer");
    if (!container) return;

    const accounts = state.accounts || [];
    if (accounts.length === 0) {
      container.innerHTML = `<div style="padding:16px; color:var(--text-muted); text-align:center;">No accounts connected.</div>`;
      return;
    }

    let html = "";
    accounts.forEach(acc => {
      const typeBadgeClass = acc.type === "savings" ? "badge-savings" : "badge-spending";
      html += `
        <div class="account-item" data-acc-id="${acc.id}">
          <div class="account-header">
            <div class="account-info">
              <div class="account-name">
                ${acc.name}
                <span class="badge-tag ${typeBadgeClass}">${acc.type}</span>
              </div>
              <div class="account-meta">${acc.officialName || acc.subtype}</div>
            </div>
            <div class="account-balance" style="color: ${acc.currentBalance < 0 ? 'var(--accent-danger)' : 'var(--text-main)'}">
              ${formatCurrency(acc.currentBalance)}
            </div>
          </div>
          <div class="account-details" id="details-${acc.id}">
            <div style="font-size:0.8rem; font-weight:600; margin-bottom:6px; color:var(--text-muted);">
              Historical Balance Chart
            </div>
            <div class="chart-container" style="height:200px;">
              <canvas id="chart-${acc.id}"></canvas>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click listeners to expand account details
    container.querySelectorAll(".account-header").forEach(header => {
      header.addEventListener("click", () => {
        const item = header.parentElement;
        const accId = item.getAttribute("data-acc-id");
        const details = document.getElementById(`details-${accId}`);
        const isOpen = details.classList.contains("open");

        // Toggle visibility
        if (isOpen) {
          details.classList.remove("open");
        } else {
          details.classList.add("open");
          renderIndividualAccountChart(accId, state);
        }
      });
    });
  }

  /**
   * Renders individual line chart for an expanded account
   */
  function renderIndividualAccountChart(accId, state) {
    const canvasId = `chart-${accId}`;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (accountCharts[accId]) {
      accountCharts[accId].destroy();
    }

    const history = state.balanceHistory || [];
    const labels = history.map(item => item.date);
    const data = history.map(item => item[accId] || 0);

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
    renderAccountsList(state);
  }

  return {
    init,
    renderMainBalanceChart
  };
})();
