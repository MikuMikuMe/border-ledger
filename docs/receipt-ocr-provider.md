# Receipt OCR providers

Receipt OCR settings are separate from spending-analysis settings. In the receipt scanner, open **Receipt OCR provider settings** and choose Microsoft Document Intelligence, OpenAI, or Anthropic. Microsoft uses the application's configured resource. For an AI provider, enter your key and model; the key is stored encrypted for the current user and ledger. Replacing or removing it does not change spending-analysis settings.

The Microsoft integration uses the `prebuilt-receipt` v4 API. AI receipt OCR calls the official OpenAI chat-completions or Anthropic messages endpoint directly. Custom endpoints are not supported. The chosen model must support image input. Provider billing and data policies apply.

Local OCR remains available. Each remote image scan requires explicit confirmation. Microsoft temporarily stores the submitted image and result for up to 24 hours; the application requests early deletion after processing but cannot guarantee it if the request fails. Other providers have their own retention policies. The application does not intentionally persist receipt images or recognized text.

AI interpretation may suggest a category from the ledger's active categories, which are shared with the selected AI provider after confirmation. Suggestions must match an active category and do not replace a category the user selected. Local OCR and Microsoft receipt analysis do not infer categories. All suggestions remain editable in the manual transaction form and require the user to save.

## Deployment prerequisites

Apply migration `0038-receipt-ocr-settings.sql` and configure the existing credential encryption key before using AI provider settings. Set the GitHub Actions variable `RECEIPT_AZURE_ENDPOINT` to the Microsoft resource endpoint and the Cloudflare production Worker secret `RECEIPT_AZURE_KEY` to its key. The deployment workflow passes the endpoint to the Worker; the key is supplied directly to Cloudflare and must not be placed in GitHub variables or source control. The secret must be created with its real value; an empty placeholder is not a working secret. AI OCR calls the official providers directly and does not require the AI egress container, a service binding, or an egress authentication secret.

Provider accuracy must be measured separately with a configured resource and a representative manually verified test set; see [receipt OCR evaluation](receipt-ocr-evaluation.md).
