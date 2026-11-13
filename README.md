# United HVAC Motors – product feeds

Builds one Spanish (es-US) Google Merchant Center feed every day and publishes it on GitHub Pages:

- https://onedobit.github.io/United-HVAC-Feeds/google-feed-es.xml
- https://onedobit.github.io/United-HVAC-Feeds/google-feed-es.xml.gz (same file, gzipped; Merchant Center accepts it)

Source: the theme template `collection.google-feed-es` (United-HVAC-Motors theme repo), read page by page
from `https://unitedhvacmotors.com/es/collections/all?view=google-feed-es&country=US`.
Shopify serves at most 250 products per page and stops at 25,000, so `build-google-feed-es.mjs` reads oldest-first,
then newest-first, removes duplicates by `g:id` and writes a single file. It refuses to publish if it gets
fewer than `MIN_ITEMS` (20,000) products, so a bad run never wipes products from Merchant Center.

Run manually: Actions → "Build Spanish Google feed" → Run workflow. Locally: `node build-google-feed-es.mjs public`.

Keep `build-google-feed-es.mjs` in sync with `scripts/build-google-feed-es.mjs` in the theme repo.
