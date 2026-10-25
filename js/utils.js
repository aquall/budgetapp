window.AppUtils = Object.freeze({
  categoryLabels: Object.freeze({
    rent: "Rent",
    groceries: "Groceries",
    utilities: "Utilities",
    leisure: "Leisure",
    travel: "Travel",
    other: "Other"
  }),

  formatCurrency(value) {
    const amount = Number(value) || 0;
    const formatted = Math.abs(amount).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${amount < 0 ? "-" : ""}$${formatted}`;
  },

  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }
});
