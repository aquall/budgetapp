/**
 * Tab 2: Spending Breakdown & Budget Analysis Module
 */
window.SpendingModule = (function () {
  let pieChart = null;

  const CATEGORY_COLORS = {
    rent: "#ef4444",      // Red
    groceries: "#10b981", // Green
    utilities: "#f59e0b", // Amber/Orange
    leisure: "#3b82f6",   // Blue
    travel: "#8b5cf6",    // Purple
    other: "#64748b"      // Slate/Gray
  };

  const CATEGORY_LABELS = {
    rent: "Rent",
    groceries: "Groceries",
    utilities: "Utilities",
    leisure: "Leisure",
    travel: "Travel",
    other: "Other"
  };

  /**
   * Helper to format currency
   */
  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return "$" + num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Categorizes a transaction description based on user defined keyword rules
   */
  function classifyCategory(txName, defaultCat, keywordRules) {
    if (!txName) return defaultCat || "other";
    const nameLower = txName.toLowerCase();

    if (keywordRules && Array.isArray(keywordRules)) {
      for (const rule of keywordRules) {
        if (rule.keyword && nameLower.includes(rule.keyword.toLowerCase())) {
          return rule.category;
        }
      }
    }

    const catLower = (defaultCat || "").toLowerCase();
    if (CATEGORY_LABELS[catLower]) return catLower;

    // Default fallback heuristics
    if (nameLower.includes("rent") || nameLower.includes("equity")) return "rent";
    if (nameLower.includes("trader") || nameLower.includes("groc") || nameLower.includes("market") || nameLower.includes("whole foods")) return "groceries";
    if (nameLower.includes("coned") || nameLower.includes("electric") || nameLower.includes("verizon") || nameLower.includes("water") || nameLower.includes("gas")) return "utilities";
    if (nameLower.includes("steam") || nameLower.includes("starbucks") || nameLower.includes("cafe") || nameLower.includes("cinema") || nameLower.includes("bar")) return "leisure";
    if (nameLower.includes("airline") || nameLower.includes("flight") || nameLower.includes("hotel") || nameLower.includes("delta") || nameLower.includes("uber")) return "travel";

    return "other";
  }

  /**
   * Filter transactions to withdrawals from designated SPENDING accounts within target date range
   */
  function getSpendingWithdrawals(state, targetDays = 90) {
    const spendingAccIds = new Set(
      (state.accounts || []).filter(a => a.type === "spending").map(a => a.id)
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - targetDays);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const rules = state.keywordRules || [];

    const withdrawals = [];
    (state.transactions || []).forEach(tx => {
      // Check if account is spending account
      if (!spendingAccIds.has(tx.accountId)) return;
      // Filter for withdrawals (amount > 0 in standard accounting convention)
      if (tx.amount <= 0) return;
      // Date cutoff filter
      if (tx.date < cutoffStr) return;

      const category = classifyCategory(tx.name, tx.category, rules);
      withdrawals.push({
        ...tx,
        classifiedCategory: category
      });
    });

    return withdrawals;
  }

  /**
   * Renders Chart.js Pie Chart of Spending Categories
   */
  function renderSpendingPieChart(withdrawals) {
    const ctx = document.getElementById("spendingPieChart");
    if (!ctx) return;

    // Aggregate totals per category
    const categoryTotals = {
      rent: 0,
      groceries: 0,
      utilities: 0,
      leisure: 0,
      travel: 0,
      other: 0
    };

    withdrawals.forEach(tx => {
      const cat = tx.classifiedCategory;
      if (categoryTotals[cat] !== undefined) {
        categoryTotals[cat] += tx.amount;
      } else {
        categoryTotals.other += tx.amount;
      }
    });

    const labels = Object.keys(categoryTotals).map(cat => CATEGORY_LABELS[cat]);
    const data = Object.values(categoryTotals);
    const backgroundColors = Object.keys(categoryTotals).map(cat => CATEGORY_COLORS[cat]);

    if (pieChart) {
      pieChart.destroy();
    }

    pieChart = new Chart(ctx, {
      type: "pie",
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: backgroundColors,
          borderWidth: 1,
          borderColor: "#1a1d24"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#9aa0a6",
              boxWidth: 12,
              padding: 12
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const val = ctx.raw;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatCurrency(val)} (${pct}%)`;
              }
            }
          }
        }
      }
    });

    return categoryTotals;
  }

  /**
   * Renders Budget Goals Analysis Progress Cards
   */
  function renderBudgetAnalysis(state, withdrawals, targetDays = 90) {
    const container = document.getElementById("budgetAnalysisContainer");
    if (!container) return;

    // Calculate monthly multiplier (targetDays / 30) to compute monthly average spent
    const monthRatio = Math.max(1, targetDays / 30);
    const budgets = state.budgets || {
      rent: 1600,
      groceries: 600,
      utilities: 250,
      leisure: 300,
      travel: 200,
      other: 250
    };

    // Calculate total spend per category in current window
    const categoryTotals = {
      rent: 0,
      groceries: 0,
      utilities: 0,
      leisure: 0,
      travel: 0,
      other: 0
    };

    withdrawals.forEach(tx => {
      const cat = tx.classifiedCategory;
      if (categoryTotals[cat] !== undefined) {
        categoryTotals[cat] += tx.amount;
      } else {
        categoryTotals.other += tx.amount;
      }
    });

    let html = "";
    Object.keys(budgets).forEach(cat => {
      const totalSpentInPeriod = categoryTotals[cat] || 0;
      const monthlyAvgSpent = totalSpentInPeriod / monthRatio;
      const targetBudget = Number(budgets[cat]) || 0;

      const pctUsed = targetBudget > 0 ? Math.min(100, (monthlyAvgSpent / targetBudget) * 100) : 0;
      const isOverBudget = monthlyAvgSpent > targetBudget;

      let fillClass = "";
      if (pctUsed >= 100 || isOverBudget) {
        fillClass = "danger";
      } else if (pctUsed >= 80) {
        fillClass = "warning";
      }

      html += `
        <div class="budget-card">
          <div class="budget-header">
            <span>${CATEGORY_LABELS[cat] || cat}</span>
            <span style="color:${isOverBudget ? 'var(--accent-danger)' : 'var(--text-main)'}">
              ${formatCurrency(monthlyAvgSpent)} / ${formatCurrency(targetBudget)}
            </span>
          </div>
          <div class="budget-progress-bg">
            <div class="budget-progress-fill ${fillClass}" style="width: ${pctUsed.toFixed(1)}%;"></div>
          </div>
          <div class="budget-subtext">
            <span>${pctUsed.toFixed(1)}% of goal</span>
            <span>${isOverBudget ? 'Over by ' + formatCurrency(monthlyAvgSpent - targetBudget) : formatCurrency(targetBudget - monthlyAvgSpent) + ' remaining'}</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /**
   * Initializes Tab 2
   */
  function init(state, targetDays = 90) {
    const withdrawals = getSpendingWithdrawals(state, targetDays);
    renderSpendingPieChart(withdrawals);
    renderBudgetAnalysis(state, withdrawals, targetDays);
  }

  return {
    init,
    classifyCategory
  };
})();
