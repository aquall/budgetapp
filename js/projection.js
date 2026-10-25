/**
 * Tab 3: Financial Projection & Extrapolation Engine Module
 */
window.ProjectionModule = (function () {
  let projectionChart = null;
  const { formatCurrency, escapeHtml } = window.AppUtils;

  /**
   * Extracts historical balance series for chosen account filter & training date window
   */
  function getHistoricalSeries(state, accountSelection, trainDays) {
    const history = (state.balanceHistory || [])
      .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (history.length === 0) return [];

    let filtered = history;
    const days = Number(trainDays) || 0;
    if (days > 0) {
      // Imported and saved histories may not include today. Fit against a
      // window ending at the newest available balance instead of the clock.
      const cutoff = new Date(`${history[history.length - 1].date}T00:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filtered = history.filter(item => item.date >= cutoffStr);
    }

    if (filtered.length === 0) return [];

    const matchingAccounts = accountSelection === "SPENDING"
      ? (state.accounts || []).filter(account => account.type === "spending")
      : accountSelection === "SAVINGS"
        ? (state.accounts || []).filter(account => account.type === "savings")
        : null;
    if (matchingAccounts && !matchingAccounts.length) return [];

    // Filter accounts
    return filtered.map(item => {
      let balance = 0;
      if (accountSelection === "ALL") {
        balance = Number(item.total);
      } else if (accountSelection === "SPENDING") {
        balance = matchingAccounts.reduce((sum, account) => sum + (Number(item[account.id]) || 0), 0);
      } else if (accountSelection === "SAVINGS") {
        balance = matchingAccounts.reduce((sum, account) => sum + (Number(item[account.id]) || 0), 0);
      } else {
        // Specific account ID
        balance = Number(item[accountSelection]);
      }
      return {
        date: item.date,
        balance: Math.round(balance * 100) / 100
      };
    }).filter(point => Number.isFinite(point.balance));
  }

  /**
   * Performs Ordinary Least Squares Linear Regression & Smooth Extrapolation
   */
  function calculateLinearFit(series, futureMonths) {
    if (series.length < 2) return [];

    const n = series.length;
    const startDate = new Date(series[0].date);

    // Convert dates to numeric day offsets from start date
    const points = series.map(pt => {
      const d = new Date(pt.date);
      const dayOffset = (d - startDate) / (1000 * 60 * 60 * 24);
      return { x: dayOffset, y: pt.balance, date: pt.date };
    });

    const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
    const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
    const slope = varianceX > 0 ? covariance / varianceX : 0; // Growth rate ($ / day)
    const intercept = meanY - slope * meanX;

    // Historical points
    const historicalFitted = points.map((point, index) => ({
      date: point.date,
      historical: series[index].balance,
      trend: Math.round((intercept + slope * point.x) * 100) / 100,
      projected: null
    }));

    const lastPt = series[series.length - 1];
    const lastDate = new Date(lastPt.date);
    const startingBal = lastPt.balance;

    // Anchor bridge point at end of historical line
    historicalFitted[historicalFitted.length - 1].projected = startingBal;

    // Future extrapolation points
    const futurePoints = [];
    const totalDays = futureMonths * 30;
    const stepDays = 15; // Plot every 15 days

    for (let d = stepDays; d <= totalDays; d += stepDays) {
      const futDate = new Date(lastDate);
      futDate.setUTCDate(futDate.getUTCDate() + d);
      const dateStr = futDate.toISOString().split("T")[0];
      
      // Smooth linear extrapolation: Y_end + (slope * days)
      const projectedBal = startingBal + (slope * d);

      futurePoints.push({
        date: dateStr,
        historical: null,
        trend: null,
        projected: Math.round(projectedBal * 100) / 100
      });
    }

    return [...historicalFitted, ...futurePoints];
  }

  /**
   * Calculates Exponential Growth Extrapolation with custom interest rate & monthly deposit
   */
  function calculateExponentialFit(series, futureMonths, annualInterestPct, monthlyDeposit) {
    if (series.length < 1) return [];

    const historicalFitted = series.map(pt => ({
      date: pt.date,
      historical: pt.balance,
      projected: null
    }));

    const lastPt = series[series.length - 1];
    const lastDate = new Date(lastPt.date);
    let currentBal = lastPt.balance;

    historicalFitted[historicalFitted.length - 1].projected = currentBal;

    const rMonthly = (Number(annualInterestPct) || 0) / 100 / 12;
    const deposit = Number(monthlyDeposit) || 0;

    const futurePoints = [];
    const totalDays = futureMonths * 30;
    const stepDays = 15;

    for (let d = stepDays; d <= totalDays; d += stepDays) {
      const futDate = new Date(lastDate);
      futDate.setUTCDate(futDate.getUTCDate() + d);
      const dateStr = futDate.toISOString().split("T")[0];

      const monthFraction = stepDays / 30;
      currentBal = currentBal * Math.pow(1 + rMonthly, monthFraction) + (deposit * monthFraction);

      futurePoints.push({
        date: dateStr,
        historical: null,
        projected: Math.round(currentBal * 100) / 100
      });
    }

    return [...historicalFitted, ...futurePoints];
  }

  /**
   * Renders the Projection Chart.js line plot
   */
  function renderProjectionChart(combinedSeries, modelType) {
    const ctx = document.getElementById("projectionChart");
    if (!ctx) return;

    const labels = combinedSeries.map(s => s.date);
    const historicalData = combinedSeries.map(s => s.historical);
    const trendData = combinedSeries.map(s => s.trend ?? null);
    const projectedData = combinedSeries.map(s => s.projected);

    if (projectionChart) {
      projectionChart.destroy();
      projectionChart = null;
    }

    const emptyState = document.getElementById("projectionEmptyState");
    const hasEnoughHistory = combinedSeries.filter(point => point.historical != null).length >= 2;
    const canRenderChart = hasEnoughHistory && typeof Chart !== "undefined";
    ctx.hidden = !canRenderChart;
    if (emptyState) {
      emptyState.hidden = canRenderChart;
      emptyState.textContent = typeof Chart === "undefined"
        ? "Charts could not load. Check your internet connection and reload the app."
        : combinedSeries.length === 0
          ? "No balances match this account and date window. Try All Historical Data, select another account group, or sync transactions."
          : "At least two historical balance points are needed. Sync transaction history from an institution first.";
    }
    if (!canRenderChart) return;

    // Update UI badge indicator
    const badge = document.getElementById("projectionModelBadge");
    if (badge) {
      badge.textContent = modelType === "exponential" ? "Exponential Growth" : "Linear Fit";
    }

    projectionChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Historical Balance",
            data: historicalData,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.1,
            pointRadius: 0
          },
          ...(modelType === "linear" ? [{
            label: "Fitted Linear Trend",
            data: trendData,
            borderColor: "#f59e0b",
            borderDash: [3, 3],
            backgroundColor: "transparent",
            borderWidth: 2,
            fill: false,
            tension: 0,
            pointRadius: 0
          }] : []),
          {
            label: "Extrapolated Balance",
            data: projectedData,
            borderColor: "#10b981",
            borderDash: [6, 4],
            backgroundColor: "rgba(16, 185, 129, 0.05)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.1,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#9aa0a6" }
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              label: (ctx) => {
                if (ctx.raw == null) return null;
                return ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`;
              }
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
   * Update the account selection dropdown with current accounts list
   */
  function populateAccountDropdown(state) {
    const accSelectEl = document.getElementById("projAccountSelect");
    if (!accSelectEl) return;

    const currentVal = accSelectEl.value || "ALL";
    const accounts = state.accounts || [];

    let html = `
      <option value="ALL">All Accounts (Combined)</option>
      <option value="SPENDING">Spending Accounts Only</option>
      <option value="SAVINGS">Savings Accounts Only</option>
    `;

    accounts.forEach(acc => {
      html += `<option value="${escapeHtml(acc.id)}">${escapeHtml(acc.name)} (${escapeHtml(acc.type)})</option>`;
    });

    accSelectEl.innerHTML = html;
    accSelectEl.value = [...accSelectEl.options].some(option => option.value === currentVal) ? currentVal : "ALL";
  }

  /**
   * Initializes or updates Tab 3
   */
  function init(state, params = {}) {
    populateAccountDropdown(state);

    const accSel = params.accountSelection || document.getElementById("projAccountSelect")?.value || "ALL";
    const trainDays = Number(params.trainDays !== undefined ? params.trainDays : (document.getElementById("projTrainWindow")?.value || 90));
    const modelType = params.modelType || document.getElementById("projModelType")?.value || "linear";
    const futureMonths = Number(params.futureMonths || document.getElementById("projFutureHorizon")?.value || 12);
    const interestRate = Number(params.interestRate !== undefined
      ? params.interestRate
      : (document.getElementById("projInterestRate")?.value ?? 5.0));
    const monthlyDeposit = Number(params.monthlyDeposit !== undefined
      ? params.monthlyDeposit
      : (document.getElementById("projMonthlyDeposit")?.value ?? 250));

    const histSeries = getHistoricalSeries(state, accSel, trainDays);

    let projectedResults = [];
    if (modelType === "exponential") {
      projectedResults = calculateExponentialFit(histSeries, futureMonths, interestRate, monthlyDeposit);
    } else {
      projectedResults = calculateLinearFit(histSeries, futureMonths);
    }

    renderProjectionChart(projectedResults, modelType);
  }

  return {
    init,
    populateAccountDropdown
  };
})();
