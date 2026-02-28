## Selected API

- Endpoint: `https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes` and recipe detail pages under `https://www.epicurious.com/recipes/food/views/*` (data source: embedded `window.__PRELOADED_STATE__` JSON payload)
- Method: `GET`
- Auth: None
- Pagination: Page query parameter (`?page=2`, `?page=3`, ...) and next-page link discovery
- Fields available:
  - `@context`, `@type`, `articleBody`, `alternativeHeadline`, `keywords`, `thumbnailUrl`, `publisher`, `isPartOf`, `isAccessibleForFree`, `author`, `aggregateRating`, `description`, `image`, `headline`, `name`, `cookTime`, `recipeIngredient`, `recipeInstructions`, `totalTime`, `recipeYield`, `url`, `dateModified`, `datePublished`
  - Additional list/detail metadata from preloaded state (canonical URLs, content IDs, slugs, tags, bylines, media fields)
- Fields currently missing in actor (newly added in rewrite):
  - `@context`, `@type`, `articleBody`, `alternativeHeadline`, `keywords_raw`, `thumbnailUrl`, `publisher`, `isPartOf`, `isAccessibleForFree`, `raw`
- Field count: 23+ core recipe fields in the selected payload vs ~15-18 consistently populated fields in previous HTML/JSON-LD hybrid extraction

## Candidate Endpoint Scoring

| Endpoint | JSON Direct | >15 Fields | No Auth | Pagination | Extends Existing | Score |
|---|---:|---:|---:|---:|---:|---:|
| Epicurious page preloaded-state payload (`window.__PRELOADED_STATE__`) | 20 | 25 | 20 | 15 | 10 | 90 |
| `https://coral.condenastdigital.com/api/graphql` | 30 | 10 | 20 | 0 | 0 | 60 |
| Consent/chat JSON endpoints | 30 | 25 | 20 | 0 | 0 | 75 |

Notes:
- URLScan showed multiple JSON endpoints; only the preloaded-state payload consistently carries recipe entity data with full ingredient/instruction coverage.
- The GraphQL endpoint exists but does not consistently expose complete recipe extraction fields for this actor use case without undocumented operations.