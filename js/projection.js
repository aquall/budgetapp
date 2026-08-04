/**
 * Tab 3: Financial Projection & Extrapolation Engine Module
 */
window.ProjectionModule = (function () {
  let projectionChart = null;

  /**
   * Helper to format currency
   */
  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return (num < 0 ? "-" : "") + "$" + Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Extracts historical balance series for chosen account filter & training date window
   */
  function getHistoricalSeries(state, accountSelection, trainDays) {
    const history = state.balanceHistory || [];
    if (history.length === 0) return [];

    let filtered = history;
    const days = Number(trainDays) || 0;
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      filtered = history.filter(item => item.date >= cutoffStr);
    }

    if (filtered.length === 0) filtered = history;

    // Filter accounts
    return filtered.map(item => {
      let balance = 0;
      if (accountSelection === "ALL") {
        balance = item.total;
      } else if (accountSelection === "SPENDING") {
        const spendingAccs = (state.accounts || []).filter(a => a.type === "spending").map(a => a.id);
        balance = spendingAccs.reduce((sum, accId) => sum + (item[accId] || 0), 0);
      } else if (accountSelection === "SAVINGS") {
        const savingsAccs = (state.accounts || []).filter(a => a.type === "savings").map(a => a.id);
        balance = savingsAccs.reduce((sum, accId) => sum + (item[accId] || 0), 0);
      } else {
        // Specific account ID
        balance = item[accountSelection] !== undefined ? item[accountSelection] : 0;
      }
      return {
        date: item.date,
        balance: Math.round(balance * 100) / 100
      };
    });
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

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    points.forEach(p => {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumXX += p.x * p.x;
    });

    const denom = (n * sumXX - sumX * sumX);
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0; // Growth rate ($ / day)

    // Historical points
    const historicalFitted = series.map(pt => ({
      date: pt.date,
      historical: pt.balance,
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
      futDate.setDate(futDate.getDate() + d);
      const dateStr = futDate.toISOString().split("T")[0];
      
      // Smooth linear extrapolation: Y_end + (slope * days)
      const projectedBal = Math.max(0, startingBal + (slope * d));

      futurePoints.push({
        date: dateStr,
        historical: null,
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
      futDate.setDate(futDate.getDate() + d);
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
    const projectedData = combinedSeries.map(s => s.projected);

    if (projectionChart) {
      projectionChart.destroy();
    }

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
      html += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`;
    });

    accSelectEl.innerHTML = html;
    accSelectEl.value = currentVal;
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
    const interestRate = Number(params.interestRate || document.getElementById("projInterestRate")?.value || 5.0);
    const monthlyDeposit = Number(params.monthlyDeposit || document.getElementById("projMonthlyDeposit")?.value || 250);

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
