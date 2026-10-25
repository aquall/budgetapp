/**
 * Tab 2: Spending Breakdown & Budget Analysis Module
 */
window.SpendingModule = (function () {
  let pieChart = null;
  const { formatCurrency, escapeHtml } = window.AppUtils;

  const CATEGORY_COLORS = {
    rent: "#ef4444",      // Red
    groceries: "#10b981", // Green
    utilities: "#f59e0b", // Amber/Orange
    leisure: "#3b82f6",   // Blue
    travel: "#8b5cf6",    // Purple
    other: "#64748b"      // Slate/Gray
  };

  const CATEGORY_LABELS = window.AppUtils.categoryLabels;

  function normalizeCategoryText(value) {
    return String(value || "").toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function findCategoryRule(txName, keywordRules, amount) {
    const normalizedName = normalizeCategoryText(txName);
    const direction = Number(amount) < 0 ? "inflow" : "outflow";
    return (keywordRules || []).find(rule => {
      const ruleDirection = rule?.direction || "outflow";
      const normalizedKeyword = normalizeCategoryText(rule?.keyword);
      return normalizedKeyword && CATEGORY_LABELS[rule?.category] &&
        (ruleDirection === "any" || ruleDirection === direction) &&
        normalizedName.includes(normalizedKeyword);
    });
  }

  /**
   * Categorizes a transaction description based on user defined keyword rules
   */
  function classifyCategory(txName, defaultCat, keywordRules, amount = 1) {
    const nameLower = String(txName).toLowerCase();
    const matchingRule = findCategoryRule(txName, keywordRules, amount);
    if (matchingRule) return matchingRule.category;

    const catLower = String(defaultCat || "").toLowerCase();
    if (CATEGORY_LABELS[catLower]) return catLower;
    if (!txName && !catLower) return "other";

    // Default fallback heuristics
    if (nameLower.includes("rent") || nameLower.includes("equity")) return "rent";
    if (nameLower.includes("trader") || nameLower.includes("groc") || nameLower.includes("market") || nameLower.includes("whole foods")) return "groceries";
    if (nameLower.includes("coned") || nameLower.includes("electric") || nameLower.includes("verizon") || nameLower.includes("water") || nameLower.includes("gas")) return "utilities";
    if (nameLower.includes("steam") || nameLower.includes("starbucks") || nameLower.includes("cafe") || nameLower.includes("cinema") || /\bbar\b/.test(nameLower)) return "leisure";
    if (nameLower.includes("airline") || nameLower.includes("flight") || nameLower.includes("hotel") || nameLower.includes("delta") || nameLower.includes("uber")) return "travel";

    // Plaid's Personal Finance Category values are broader than the app's
    // budget categories (for example RENT_AND_UTILITIES). Map those values
    // after merchant-name heuristics so a known utility vendor stays Utilities.
    if (/rent/.test(catLower)) return "rent";
    if (/utilit|bill/.test(catLower)) return "utilities";
    if (/food|grocery/.test(catLower)) return "groceries";
    if (/travel|transportation/.test(catLower)) return "travel";
    if (/entertainment|recreation|personal care/.test(catLower)) return "leisure";
    if (/income|payroll/.test(catLower)) return "income";
    if (/transfer/.test(catLower)) return "transfer";

    return "other";
  }

  /**
   * Filter transactions to withdrawals from designated SPENDING accounts within target date range
   */
  function getSpendingWithdrawals(state, targetDays = 90) {
    const spendingAccIds = new Set(
      (state.accounts || []).filter(a => a.type === "spending").map(a => a.id)
    );

    const datedTransactions = (state.transactions || [])
      .filter(tx => /^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || "")) && !tx.pending)
      .map(tx => tx.date)
      .sort();
    const latestDate = datedTransactions[datedTransactions.length - 1];
    if (!latestDate) return [];
    const cutoff = new Date(`${latestDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - targetDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rules = state.keywordRules || [];

    const withdrawals = [];
    (state.transactions || []).forEach(tx => {
      // Check if account is spending account
      if (!spendingAccIds.has(tx.accountId)) return;
      if (tx.pending) return;
      // Filter for withdrawals (amount > 0 in standard accounting convention)
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      // Date cutoff filter
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || "")) || tx.date < cutoffStr) return;

      const hasExplicitCategoryRule = Boolean(findCategoryRule(tx.name, rules, amount));
      if (!hasExplicitCategoryRule && /transfer|loan payment/i.test(String(tx.category || ""))) return;
      const category = classifyCategory(tx.name, tx.category, rules, amount);
      if (category === "transfer") return;
      withdrawals.push({
        ...tx,
        amount,
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
    const emptyState = document.getElementById("spendingEmptyState");
    const hasSpending = withdrawals.length > 0;
    const canRenderChart = hasSpending && typeof Chart !== "undefined";
    ctx.hidden = !canRenderChart;
    if (emptyState) {
      emptyState.hidden = canRenderChart;
      emptyState.textContent = typeof Chart === "undefined"
        ? "Charts could not load. Check your internet connection and reload the app."
        : "No posted withdrawals found for spending accounts in this period. Connect or sync an account, or check its type under Settings.";
    }

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
      pieChart = null;
    }
    if (!canRenderChart) return categoryTotals;

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
    if (!withdrawals.length) {
      container.innerHTML = `<p class="chart-empty-state">Budget comparisons appear after posted withdrawals are available.</p>`;
      return;
    }

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
          <span>${escapeHtml(CATEGORY_LABELS[cat] || cat)}</span>
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
    classifyCategory,
    findCategoryRule
  };
})();
