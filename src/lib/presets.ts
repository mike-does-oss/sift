import type { ExtractionField } from "@/types";

export interface PresetTemplate {
  key: string; // stable slug
  name: string;
  description: string; // one line, user-facing
  fields: ExtractionField[]; // ids like "<key>-1", "<key>-2", …
  prompt: string;
  extractMultiple: boolean;
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    key: "bank-statement-transactions",
    name: "Bank statement — transactions",
    description: "Every transaction row from a bank statement, one row per transaction.",
    extractMultiple: true,
    prompt:
      "Extract every transaction row from this bank statement. Use debit for money out and credit for money in; null the other.",
    fields: [
      { id: "bank-statement-transactions-1", name: "date", type: "date" },
      { id: "bank-statement-transactions-2", name: "description", type: "text" },
      {
        id: "bank-statement-transactions-3",
        name: "debit",
        type: "number",
        description: "Money out; null if this row is a credit",
      },
      {
        id: "bank-statement-transactions-4",
        name: "credit",
        type: "number",
        description: "Money in; null if this row is a debit",
      },
      { id: "bank-statement-transactions-5", name: "balance", type: "number" },
    ],
  },
  {
    key: "bank-statement-summary",
    name: "Bank statement — summary",
    description: "Account holder, period, and balance summary from a bank statement.",
    extractMultiple: false,
    prompt: "Extract the account summary details from this bank statement.",
    fields: [
      { id: "bank-statement-summary-1", name: "account_holder", type: "text" },
      { id: "bank-statement-summary-2", name: "account_number_last4", type: "text" },
      { id: "bank-statement-summary-3", name: "statement_period_start", type: "date" },
      { id: "bank-statement-summary-4", name: "statement_period_end", type: "date" },
      { id: "bank-statement-summary-5", name: "opening_balance", type: "number" },
      { id: "bank-statement-summary-6", name: "closing_balance", type: "number" },
      { id: "bank-statement-summary-7", name: "total_deposits", type: "number" },
      { id: "bank-statement-summary-8", name: "total_withdrawals", type: "number" },
    ],
  },
  {
    key: "invoice",
    name: "Invoice",
    description: "Header details and totals from an invoice.",
    extractMultiple: false,
    prompt: "Extract the header and totals from this invoice.",
    fields: [
      { id: "invoice-1", name: "invoice_number", type: "text" },
      { id: "invoice-2", name: "vendor_name", type: "text" },
      { id: "invoice-3", name: "invoice_date", type: "date" },
      { id: "invoice-4", name: "due_date", type: "date" },
      { id: "invoice-5", name: "subtotal", type: "number" },
      { id: "invoice-6", name: "tax", type: "number" },
      { id: "invoice-7", name: "total", type: "number" },
      { id: "invoice-8", name: "currency", type: "text" },
    ],
  },
  {
    key: "receipt",
    name: "Receipt",
    description: "Merchant, totals, and line items from a purchase receipt.",
    extractMultiple: false,
    prompt: "Extract the purchase details from this receipt.",
    fields: [
      { id: "receipt-1", name: "merchant", type: "text" },
      { id: "receipt-2", name: "purchase_date", type: "date" },
      { id: "receipt-3", name: "total", type: "number" },
      { id: "receipt-4", name: "tax", type: "number" },
      { id: "receipt-5", name: "payment_method", type: "text" },
      { id: "receipt-6", name: "items", type: "array" },
    ],
  },
  {
    key: "pay-stub",
    name: "Pay stub",
    description: "Pay period and earnings breakdown from an employee pay stub.",
    extractMultiple: false,
    prompt: "Extract the pay period and amounts from this pay stub.",
    fields: [
      { id: "pay-stub-1", name: "employee_name", type: "text" },
      { id: "pay-stub-2", name: "employer_name", type: "text" },
      { id: "pay-stub-3", name: "pay_period_start", type: "date" },
      { id: "pay-stub-4", name: "pay_period_end", type: "date" },
      { id: "pay-stub-5", name: "gross_pay", type: "number" },
      { id: "pay-stub-6", name: "total_deductions", type: "number" },
      { id: "pay-stub-7", name: "net_pay", type: "number" },
    ],
  },
  {
    key: "purchase-order-lines",
    name: "Purchase order — line items",
    description: "Every line item from a purchase order, one row per item.",
    extractMultiple: true,
    prompt: "Extract every line item from this purchase order.",
    fields: [
      { id: "purchase-order-lines-1", name: "item_description", type: "text" },
      { id: "purchase-order-lines-2", name: "sku", type: "text" },
      { id: "purchase-order-lines-3", name: "quantity", type: "number" },
      { id: "purchase-order-lines-4", name: "unit_price", type: "number" },
      { id: "purchase-order-lines-5", name: "line_total", type: "number" },
    ],
  },
  {
    key: "utility-bill",
    name: "Utility bill",
    description: "Billing period, usage, and amount due from a utility bill.",
    extractMultiple: false,
    prompt: "Extract the billing details from this utility bill.",
    fields: [
      { id: "utility-bill-1", name: "provider", type: "text" },
      { id: "utility-bill-2", name: "account_number", type: "text" },
      { id: "utility-bill-3", name: "billing_period_start", type: "date" },
      { id: "utility-bill-4", name: "billing_period_end", type: "date" },
      { id: "utility-bill-5", name: "amount_due", type: "number" },
      { id: "utility-bill-6", name: "due_date", type: "date" },
      {
        id: "utility-bill-7",
        name: "usage_amount",
        type: "number",
        description: "Consumption amount, e.g. kWh or gallons",
      },
      { id: "utility-bill-8", name: "usage_unit", type: "text" },
    ],
  },
  {
    key: "resume",
    name: "Résumé / CV",
    description: "Contact details and profile summary from a résumé.",
    extractMultiple: false,
    prompt: "Extract the candidate's contact details and profile from this résumé.",
    fields: [
      { id: "resume-1", name: "full_name", type: "text" },
      { id: "resume-2", name: "email", type: "text" },
      { id: "resume-3", name: "phone", type: "text" },
      { id: "resume-4", name: "location", type: "text" },
      { id: "resume-5", name: "current_title", type: "text" },
      { id: "resume-6", name: "skills", type: "array" },
      { id: "resume-7", name: "years_of_experience", type: "number" },
    ],
  },
  {
    key: "contract",
    name: "Contract — key terms",
    description: "Parties, dates, and key legal terms from a contract.",
    extractMultiple: false,
    prompt: "Extract the key legal terms from this contract.",
    fields: [
      { id: "contract-1", name: "parties", type: "array" },
      { id: "contract-2", name: "effective_date", type: "date" },
      {
        id: "contract-3",
        name: "term_description",
        type: "text",
        description: "Duration or term of the agreement",
      },
      { id: "contract-4", name: "governing_law", type: "text" },
      { id: "contract-5", name: "auto_renews", type: "boolean" },
      { id: "contract-6", name: "termination_notice_days", type: "number" },
    ],
  },
];
