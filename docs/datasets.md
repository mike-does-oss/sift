# Datasets

A dataset is a durable table you append extraction results into over time — run the same template against fifty invoices across a month, keep saving the rows to one dataset, and export a single merged CSV at the end.

## Saving results to a dataset

After an extraction, use the save-to-dataset panel next to the results:

- **New dataset** — creates a dataset whose columns are the current result columns, seeded with the current rows.
- **Existing dataset** — appends the current rows to a dataset whose columns match.

The rows saved are your **edited** values, not the raw model output — fix anything in the results table first, then save. Datasets are per-user local data; nothing about them touches a model or a provider.

## Header matching

A dataset's columns (headers) are fixed at creation. An extraction can only be appended to a dataset with the **same set of column names** — order doesn't matter, but names are case-sensitive, so a dataset made from `invoice_number, total` won't accept results with `Invoice_Number`. Keeping the same template for every run is the easy way to guarantee a match.

## Append rules

When rows are appended:

- Every dataset column gets a value; a key missing from a row is stored as `null`.
- Keys that aren't dataset columns are dropped.
- Rows keep the order they were added in, and each row records when it was added.

## Editing and deleting rows

Dataset rows are read-only once appended — the editing step is the results table, before you save. If a bad row makes it in, delete that row from the dataset detail page and re-append a corrected one. Deleting a dataset removes it and all its rows.

## CSV export

**Export CSV** on a dataset downloads every row as one file, columns in header order, named after the dataset. Values that are lists are joined with `; ` in CSV cells.
