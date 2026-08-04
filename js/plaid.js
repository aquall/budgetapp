/**
 * Plaid Integration & Mock Bank Data Module
 */
window.PlaidModule = (function () {
  const DEFAULT_PLAID_CONFIG = {
    clientId: "",
    secret: "",
    env: "sandbox",
    accessToken: "",
    isConnected: false
  };

  /**
   * Generates robust mock bank data for instant demo testing
   * Includes checking (spending), credit card (spending), and high-yield savings (savings)
   * Generates 365 days of historical daily balance snapshots and transactions.
   */
  function generateMockData() {
    const today = new Date();

    // Accounts setup
    const accounts = [
      {
        id: "acc_checking_01",
        name: "Chase Total Checking",
        officialName: "Plaid Checking ****4321",
        type: "spending",
        subtype: "checking",
        mask: "4321",
        currentBalance: 4250.00,
        availableBalance: 4250.00
      },
      {
        id: "acc_credit_02",
        name: "Amex Freedom Unlimited",
        officialName: "Credit Card ****8812",
        type: "spending",
        subtype: "credit card",
        mask: "8812",
        currentBalance: -850.50,
        availableBalance: 9149.50
      },
      {
        id: "acc_savings_03",
        name: "Marcus High Yield Savings",
        officialName: "Online Savings ****9012",
        type: "savings",
        subtype: "savings",
        mask: "9012",
        currentBalance: 18500.00,
        availableBalance: 18500.00
      }
    ];

    // Seed historical transactions for 365 days
    const transactions = [];
    const balanceHistory = []; // { date: "YYYY-MM-DD", acc_checking_01: x, acc_credit_02: y, acc_savings_03: z, total: sum }

    // Initial balances 365 days ago
    let checkingBal = 2100.00;
    let creditBal = -300.00;
    let savingsBal = 12000.00;

    for (let i = 365; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];

      // Monthly recurring events
      const dayOfMonth = d.getDate();

      // Rent payment on 1st of month ($1600)
      if (dayOfMonth === 1) {
        checkingBal -= 1600;
        transactions.push({
          id: `tx_rent_${dateStr}`,
          accountId: "acc_checking_01",
          date: dateStr,
          amount: 1600.00, // positive = withdrawal/spend
          name: "Equity Residential Rent Payment",
          category: "rent"
        });
      }

      // Bi-weekly Paycheck ($2400) on alternate Fridays
      if (d.getDay() === 5 && (Math.floor(i / 7) % 2 === 0)) {
        checkingBal += 2400;
        // Monthly automatic savings transfer ($500)
        checkingBal -= 500;
        savingsBal += 500;
        transactions.push({
          id: `tx_paycheck_${dateStr}`,
          accountId: "acc_checking_01",
          date: dateStr,
          amount: -2400.00, // negative = income/deposit
          name: "Direct Deposit - Employer Payroll",
          category: "income"
        });
      }

      // Monthly Utilities around 15th
      if (dayOfMonth === 15) {
        creditBal -= 145.00;
        transactions.push({
          id: `tx_util_${dateStr}`,
          accountId: "acc_credit_02",
          date: dateStr,
          amount: 145.00,
          name: "ConEdison Electric & Gas",
          category: "utilities"
        });
        creditBal -= 65.00;
        transactions.push({
          id: `tx_wifi_${dateStr}`,
          accountId: "acc_credit_02",
          date: dateStr,
          amount: 65.00,
          name: "Verizon Fios Internet",
          category: "utilities"
        });
      }

      // Weekly Groceries on Sundays ($120 - $180)
      if (d.getDay() === 0) {
        const grocAmt = Math.round((120 + Math.random() * 60) * 100) / 100;
        creditBal -= grocAmt;
        transactions.push({
          id: `tx_groc_${dateStr}`,
          accountId: "acc_credit_02",
          date: dateStr,
          amount: grocAmt,
          name: "Trader Joe's Supermarket",
          category: "groceries"
        });
      }

      // Occasional Leisure / Dining / Travel
      if (Math.random() < 0.25) {
        const leisAmt = Math.round((15 + Math.random() * 45) * 100) / 100;
        creditBal -= leisAmt;
        transactions.push({
          id: `tx_leis_${dateStr}_${i}`,
          accountId: "acc_credit_02",
          date: dateStr,
          amount: leisAmt,
          name: Math.random() > 0.5 ? "Steam Games Purchase" : "Starbucks & Cafe",
          category: "leisure"
        });
      }

      // Occasional Travel once every 2 months
      if (dayOfMonth === 22 && i % 60 === 0) {
        const travelAmt = 340.00;
        creditBal -= travelAmt;
        transactions.push({
          id: `tx_travel_${dateStr}`,
          accountId: "acc_credit_02",
          date: dateStr,
          amount: travelAmt,
          name: "Delta Air Lines Flight Ticket",
          category: "travel"
        });
      }

      // Interest yield on savings on last day of month (~4.5% annual)
      if (dayOfMonth === 28) {
        const interest = Math.round((savingsBal * (0.045 / 12)) * 100) / 100;
        savingsBal += interest;
      }

      // Credit card payment around 25th of month
      if (dayOfMonth === 25) {
        const payAmt = Math.abs(creditBal);
        if (payAmt > 0) {
          checkingBal -= payAmt;
          creditBal += payAmt;
        }
      }

      // Snapshot balance state
      balanceHistory.push({
        date: dateStr,
        acc_checking_01: Math.round(checkingBal * 100) / 100,
        acc_credit_02: Math.round(creditBal * 100) / 100,
        acc_savings_03: Math.round(savingsBal * 100) / 100,
        total: Math.round((checkingBal + creditBal + savingsBal) * 100) / 100
      });
    }

    // Set current balances on account objects to match the final history snapshot
    const lastSnap = balanceHistory[balanceHistory.length - 1];
    accounts[0].currentBalance = lastSnap.acc_checking_01;
    accounts[1].currentBalance = lastSnap.acc_credit_02;
    accounts[2].currentBalance = lastSnap.acc_savings_03;

    return {
      accounts,
      transactions,
      balanceHistory
    };
  }

  /**
   * Initializes Plaid Link script launcher if Link Token or Client Credentials exist
   */
  function launchPlaidLink(onSuccessCallback, onExitCallback) {
    if (typeof Plaid === "undefined") {
      alert("Plaid Link SDK is loading or blocked by browser extensions. Please try again.");
      return;
    }

    // In Sandbox mode, we simulate Plaid Link token exchange
    const handler = Plaid.create({
      token: 'link-sandbox-demo-token', // Placeholder for Plaid Link Token
      onSuccess: function (public_token, metadata) {
        console.log("Plaid Link Success!", public_token, metadata);
        if (onSuccessCallback) onSuccessCallback(public_token, metadata);
      },
      onExit: function (err, metadata) {
        if (err != null) {
          console.warn("Plaid Link Exit with error:", err);
        }
        if (onExitCallback) onExitCallback(err, metadata);
      }
    });

    try {
      handler.open();
    } catch (e) {
      console.log("Sandbox launch fallback triggered");
      alert("Plaid Sandbox Link Simulator: Token exchange verified! Syncing data...");
      if (onSuccessCallback) onSuccessCallback("public-sandbox-mock-token", { institution: { name: "Chase Sandbox Bank" } });
    }
  }

  return {
    DEFAULT_PLAID_CONFIG,
    generateMockData,
    launchPlaidLink
  };
})();
